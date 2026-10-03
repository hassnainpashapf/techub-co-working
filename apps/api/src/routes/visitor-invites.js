// Phase 33 Track 8: Visitor pre-registration by members.
// Mount (coordinator): app.use('/api/visitor-invites', require('./routes/visitor-invites'));
// Members pre-register visitors (6-char code); reception checks them in by code.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { notify } = require('../lib/mailer');
const { createNotification, sendMessage } = require('../lib/notify');
const { emitWebhook } = require('../lib/webhooks');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const staffOnly = requireRole(...STAFF);
const PURPOSES = ['meeting', 'tour', 'interview', 'delivery', 'other'];

const inviteSchema = z.object({
  memberId: z.string().optional().nullable(), // staff can set; members use own
  visitorName: z.string().min(1).max(120),
  visitorEmail: z.string().email().optional().nullable(),
  visitorPhone: z.string().max(30).optional().nullable(),
  expectedAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  purpose: z.enum(PURPOSES).default('meeting'),
  notes: z.string().max(500).optional().nullable(),
});

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

async function generateCode(tenantId) {
  for (let i = 0; i < 10; i++) {
    const code = Array.from(crypto.randomBytes(6))
      .map((b) => CODE_CHARS[b % CODE_CHARS.length])
      .join('');
    const clash = await prisma.visitorInvite.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!clash) return code;
  }
  throw new Error('Could not generate unique invite code');
}

// Mark stale pending invites as expired (best-effort, fire-and-forget safe)
async function expireStale(tenantId) {
  try {
    await prisma.visitorInvite.updateMany({
      where: { tenantId, status: 'pending', expectedAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
  } catch {
    /* non-fatal */
  }
}

const includeInvite = {
  member: { select: { id: true, name: true, email: true } },
};

// POST / — create invite (member for self, staff for any member)
router.post('/', validateBody(inviteSchema), async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    let memberId = req.body.memberId || null;
    if (req.user.role === 'member') {
      memberId = req.user.memberId;
      if (!memberId) return res.status(400).json({ error: 'No member profile linked to this account.' });
    } else {
      if (!STAFF.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
      if (!memberId) return res.status(400).json({ error: 'memberId is required.' });
    }
    const member = await prisma.member.findFirst({ where: { id: memberId, tenantId } });
    if (!member) return res.status(404).json({ error: 'Member not found.' });

    const expectedAt = new Date(req.body.expectedAt);
    if (Number.isNaN(expectedAt.getTime())) return res.status(400).json({ error: 'Invalid expectedAt.' });
    if (expectedAt < new Date()) return res.status(400).json({ error: 'Expected time must be in the future.' });

    const code = await generateCode(tenantId);
    const invite = await prisma.visitorInvite.create({
      data: {
        tenantId,
        memberId,
        visitorName: req.body.visitorName.trim(),
        visitorEmail: req.body.visitorEmail || null,
        visitorPhone: req.body.visitorPhone || null,
        expectedAt,
        purpose: req.body.purpose,
        notes: req.body.notes || null,
        code,
      },
      include: includeInvite,
    });

    writeAudit(req, 'visitor_invite.created', { inviteId: invite.id, code }).catch(() => {});
    emitWebhook(tenantId, 'visitor.invite_created', { inviteId: invite.id, code }).catch(() => {});

    // Email the visitor their check-in code (fire-and-forget)
    if (invite.visitorEmail) {
      notify(tenantId, invite.visitorEmail, 'visitorInvite', {
        visitorName: invite.visitorName,
        hostName: member.name,
        code,
        expectedAt: expectedAt.toLocaleString(),
      }).catch(() => {});
    }
    // SMS/WhatsApp via provider interface (console fallback inside sendMessage)
    if (invite.visitorPhone) {
      sendMessage({
        to: invite.visitorPhone,
        channel: 'sms',
        message: `You're expected at Techub. Show this check-in code at reception: ${code}`,
      }).catch(() => {});
    }
    // Notify reception staff in-app
    createNotification(prisma, {
      tenantId,
      role: 'receptionist',
      type: 'visitor_invite',
      message: `${member.name} pre-registered visitor ${invite.visitorName} (code ${code})`,
    }).catch(() => {});

    res.status(201).json({ invite });
  } catch (e) {
    next(e);
  }
});

// GET /mine — my invites (member) or ?memberId= (staff)
router.get('/mine', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    let memberId = req.user.memberId;
    if (req.user.role !== 'member') {
      if (!STAFF.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
      memberId = req.query.memberId ? String(req.query.memberId) : memberId;
    }
    if (!memberId) return res.status(400).json({ error: 'No member profile linked.' });
    await expireStale(tenantId);
    const invites = await prisma.visitorInvite.findMany({
      where: { ...tenantFilter(req), memberId },
      include: includeInvite,
      orderBy: { expectedAt: 'desc' },
    });
    res.json({ invites });
  } catch (e) {
    next(e);
  }
});

// GET / — staff list (?status=, ?upcoming=true, ?search=)
router.get('/', staffOnly, async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    await expireStale(tenantId);
    const where = { ...tenantFilter(req) };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.upcoming === 'true') where.status = 'pending';
    if (req.query.search) {
      const s = String(req.query.search);
      where.OR = [
        { visitorName: { contains: s, mode: 'insensitive' } },
        { code: { equals: s.toUpperCase() } },
      ];
    }
    const invites = await prisma.visitorInvite.findMany({
      where,
      include: includeInvite,
      orderBy: { expectedAt: 'asc' },
      take: 200,
    });
    res.json({ invites });
  } catch (e) {
    next(e);
  }
});

// POST /checkin/:code — fast check-in by code (staff)
router.post('/checkin/:code', staffOnly, async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const code = String(req.params.code).toUpperCase().trim();
    await expireStale(tenantId);
    const invite = await prisma.visitorInvite.findUnique({
      where: { tenantId_code: { tenantId, code } },
      include: { member: { select: { id: true, name: true, email: true } } },
    });
    if (!invite) return res.status(404).json({ error: 'Invite code not found.' });
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: `Invite is ${invite.status}, cannot check in.` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const visitor = await tx.visitor.create({
        data: {
          tenantId,
          name: invite.visitorName,
          phone: invite.visitorPhone,
          email: invite.visitorEmail,
          purpose: invite.purpose,
          hostMemberId: invite.memberId,
          hostName: invite.member.name,
          badgeNo: req.body.badgeNo || null,
          notes: invite.notes,
          createdById: req.user.sub,
        },
      });
      const updated = await tx.visitorInvite.update({
        where: { id: invite.id },
        data: { status: 'checked-in' },
      });
      return { visitor, invite: updated };
    });

    writeAudit(req, 'visitor_invite.checked_in', { inviteId: invite.id, visitorId: result.visitor.id }).catch(() => {});
    emitWebhook(tenantId, 'visitor.checked_in', { visitorId: result.visitor.id, inviteId: invite.id }).catch(() => {});

    // Notify host member (fire-and-forget)
    if (invite.member?.email) {
      notify(tenantId, invite.member.email, 'visitorCheckin', {
        hostName: invite.member.name,
        visitorName: invite.visitorName,
      }).catch(() => {});
    }

    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

// POST /:id/cancel — member cancels own, staff cancels any
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const invite = await prisma.visitorInvite.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!invite) return res.status(404).json({ error: 'Invite not found.' });
    if (req.user.role === 'member' && invite.memberId !== req.user.memberId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!STAFF.includes(req.user.role) && req.user.role !== 'member') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (invite.status !== 'pending') {
      return res.status(400).json({ error: `Invite is ${invite.status}, cannot cancel.` });
    }
    const updated = await prisma.visitorInvite.update({
      where: { id: invite.id },
      data: { status: 'cancelled' },
    });
    writeAudit(req, 'visitor_invite.cancelled', { inviteId: invite.id }).catch(() => {});
    res.json({ invite: updated });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
