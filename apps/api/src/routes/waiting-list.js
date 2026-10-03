// Phase 38 Track 8: Waiting List Management — queue for prospects waiting on a space.
// Full-cycle: join -> offer (48h claim window) -> convert to member / expire.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { rateLimit } = require('../middleware/rateLimit');
const { sendEmail } = require('../lib/mailer');
const { sendSms } = require('../lib/sms');

const router = express.Router();

const STATUSES = ['waiting', 'offered', 'converted', 'expired'];
const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist'];
const staffWrite = requireRole(...STAFF_ROLES);

// ---------------------------------------------------------------------------
// Public: join the waiting list (no auth — rate-limited). Coordinator decides
// whether to expose a public frontend form; the endpoint is ready.
const joinLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many requests. Please try again later.' });

const publicJoinSchema = z.object({
  tenantSlug: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  desiredType: z.string().optional().nullable(),
  desiredDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post('/public/join', joinLimiter, validateBody(publicJoinSchema), async (req, res, next) => {
  try {
    if (!prisma.waitingListEntry) return res.status(503).json({ error: 'Waiting list not enabled yet' });
    const { tenantSlug, desiredDate, ...rest } = req.body;
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, isActive: true } });
    if (!tenant || !tenant.isActive) return res.status(404).json({ error: 'Space not found' });
    const entry = await prisma.waitingListEntry.create({
      data: {
        ...rest,
        desiredDate: desiredDate ? new Date(desiredDate) : null,
        tenantId: tenant.id,
      },
    });
    res.status(201).json({ ok: true, id: entry.id });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Staff routes
router.use(authenticate, requireTenantUser);

const entrySchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  desiredType: z.string().optional().nullable(),
  desiredDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  priority: z.number().int().min(0).max(100).optional(),
});

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'WaitingListEntry',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

function notReady(res) {
  if (!prisma.waitingListEntry) {
    res.status(503).json({ error: 'Waiting list schema not migrated yet' });
    return true;
  }
  return false;
}

// List (?status=, ?search=) — priority first, then oldest
router.get('/', async (req, res, next) => {
  try {
    if (notReady(res)) return;
    const { status, search } = req.query;
    const where = { ...tenantFilter(req) };
    if (status && STATUSES.includes(status)) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [entries, counts] = await Promise.all([
      prisma.waitingListEntry.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        include: { convertedMember: { select: { id: true, name: true } } },
      }),
      prisma.waitingListEntry.groupBy({
        by: ['status'],
        where: tenantFilter(req),
        _count: { _all: true },
      }),
    ]);
    const stats = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const c of counts) stats[c.status] = c._count._all;
    res.json({ entries, stats });
  } catch (e) { next(e); }
});

// Create entry (staff)
router.post('/', staffWrite, validateBody(entrySchema), async (req, res, next) => {
  try {
    if (notReady(res)) return;
    const { desiredDate, ...rest } = req.body;
    const entry = await prisma.waitingListEntry.create({
      data: { ...rest, desiredDate: desiredDate ? new Date(desiredDate) : null, tenantId: req.user.tenantId },
    });
    await audit(req, 'waitinglist.create', entry.id, { name: entry.name });
    res.status(201).json({ entry });
  } catch (e) { next(e); }
});

// Update entry (incl. priority)
router.patch('/:id', staffWrite, validateBody(entrySchema.partial()), async (req, res, next) => {
  try {
    if (notReady(res)) return;
    const existing = await prisma.waitingListEntry.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    const { desiredDate, ...rest } = req.body;
    const entry = await prisma.waitingListEntry.update({
      where: { id: req.params.id },
      data: { ...rest, ...(desiredDate !== undefined ? { desiredDate: desiredDate ? new Date(desiredDate) : null } : {}) },
    });
    await audit(req, 'waitinglist.update', entry.id, { name: entry.name });
    res.json({ entry });
  } catch (e) { next(e); }
});

// Offer a space — 48h claim window, email + SMS
router.post('/:id/offer', staffWrite, async (req, res, next) => {
  try {
    if (notReady(res)) return;
    const entry = await prisma.waitingListEntry.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.status === 'converted') return res.status(409).json({ error: 'Already converted to member' });
    if (entry.status === 'expired') return res.status(409).json({ error: 'Entry expired' });

    const unitNote = req.body.unitCode ? ` — unit ${req.body.unitCode}` : '';
    const html = `<p>Hi ${entry.name || 'there'},</p><p>Good news — a space${unitNote} is now available for you. Please confirm within <b>48 hours</b> or we'll offer it to the next person in line.</p><p>Reply to this email or call us to claim it.</p>`;

    if (entry.email) {
      try { await sendEmail(req.user.tenantId, { to: entry.email, subject: 'A space is available for you — claim within 48h', html }); } catch { /* non-fatal */ }
    }
    if (entry.phone) {
      try { await sendSms(req.user.tenantId, entry.phone, `Hi ${entry.name || ''} — a space is now available for you. Claim within 48 hours or we'll offer it to the next person. Reply to confirm.`); } catch { /* non-fatal */ }
    }

    const updated = await prisma.waitingListEntry.update({
      where: { id: entry.id },
      data: { status: 'offered', offeredAt: new Date(), offersMade: { increment: 1 } },
    });
    await audit(req, 'waitinglist.offer', entry.id, { name: entry.name, offersMade: updated.offersMade });
    res.json({ entry: updated });
  } catch (e) { next(e); }
});

// Convert to member (reuses Member create flow)
router.post('/:id/convert', staffWrite, validateBody(z.object({ phone: z.string().optional().nullable() })), async (req, res, next) => {
  try {
    if (notReady(res)) return;
    const entry = await prisma.waitingListEntry.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.status === 'converted') return res.status(409).json({ error: 'Already converted' });
    const phone = req.body.phone || entry.phone;
    if (!phone) return res.status(400).json({ error: 'Phone is required to create a member' });

    const member = await prisma.member.create({
      data: {
        tenantId: req.user.tenantId,
        name: entry.name,
        email: entry.email,
        phone,
        status: 'active',
        notes: entry.notes ? `Converted from waiting list. ${entry.notes}` : 'Converted from waiting list.',
      },
    });
    const updated = await prisma.waitingListEntry.update({
      where: { id: entry.id },
      data: { status: 'converted', convertedMemberId: member.id },
    });
    await audit(req, 'waitinglist.convert', entry.id, { name: entry.name, memberId: member.id });
    res.json({ entry: updated, member });
  } catch (e) { next(e); }
});

// Manual expire
router.post('/:id/expire', staffWrite, async (req, res, next) => {
  try {
    if (notReady(res)) return;
    const entry = await prisma.waitingListEntry.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    const updated = await prisma.waitingListEntry.update({ where: { id: entry.id }, data: { status: 'expired' } });
    await audit(req, 'waitinglist.expire', entry.id, { name: entry.name });
    res.json({ entry: updated });
  } catch (e) { next(e); }
});

// Delete entry
router.delete('/:id', staffWrite, async (req, res, next) => {
  try {
    if (notReady(res)) return;
    const entry = await prisma.waitingListEntry.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    await prisma.waitingListEntry.delete({ where: { id: entry.id } });
    await audit(req, 'waitinglist.delete', entry.id, { name: entry.name });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
