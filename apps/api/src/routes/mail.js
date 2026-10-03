// Phase 34 Track 5: Mail & Package Handling.
// Mount (coordinator): app.use('/api/mail', require('./routes/mail'));
// Reception logs incoming mail/packages; the member is notified automatically
// (email + in-app). Members see pending pickups in their portal.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { notify } = require('../lib/mailer');
const { createNotification } = require('../lib/notify');
const { emitWebhook } = require('../lib/webhooks');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager', 'super_admin'];
const staffOnly = requireRole(...STAFF);

const receiveSchema = z.object({
  memberId: z.string().min(1),
  type: z.enum(['letter', 'package']).default('package'),
  sender: z.string().max(200).optional().nullable(),
  trackingNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const collectSchema = z.object({
  collectedBy: z.string().max(200).optional().nullable(),
});

const includeItem = {
  member: { select: { id: true, name: true, email: true, companyName: true } },
};

async function notifyMember(tenantId, item, template, extraVars) {
  // Email (fire-and-forget, queued mailer)
  if (item.member.email) {
    notify(tenantId, item.member.email, template, {
      memberName: item.member.name,
      itemType: item.type,
      sender: item.sender,
      trackingNumber: item.trackingNumber,
      receivedAt: item.receivedAt ? new Date(item.receivedAt).toLocaleString() : '',
      ...extraVars,
    }).catch(() => {});
  }
  // In-app notification for the member's linked user
  const link = await prisma.user.findFirst({
    where: { tenantId, memberId: item.memberId },
    select: { id: true },
  }).catch(() => null);
  if (link) {
    createNotification(prisma, {
      tenantId,
      userId: link.id,
      type: 'mail',
      message: `📦 ${item.type === 'letter' ? 'Letter' : 'Package'} received at reception${item.sender ? ` from ${item.sender}` : ''} — please collect it.`,
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// GET /api/mail — list (?status=received|notified|collected, ?q= search) — staff
// ---------------------------------------------------------------------------
router.get('/', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    const status = String(req.query.status || '').trim();
    if (['received', 'notified', 'collected'].includes(status)) where.status = status;
    const q = String(req.query.q || '').trim();
    if (q) {
      where.OR = [
        { sender: { contains: q, mode: 'insensitive' } },
        { trackingNumber: { contains: q, mode: 'insensitive' } },
        { member: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const items = await prisma.mailItem.findMany({
      where,
      include: includeItem,
      orderBy: [{ status: 'asc' }, { receivedAt: 'desc' }],
      take: 300,
    });
    const counts = await prisma.mailItem.groupBy({
      by: ['status'],
      where: tf,
      _count: { _all: true },
    });
    res.json({ items, counts });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/mail/mine — member's own pending items (portal banner)
// ---------------------------------------------------------------------------
router.get('/mine', async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const memberId = req.user.memberId;
    if (!memberId) return res.json({ items: [], pending: 0 });
    const items = await prisma.mailItem.findMany({
      where: { tenantId, memberId, status: { in: ['received', 'notified'] } },
      orderBy: { receivedAt: 'desc' },
    });
    res.json({ items, pending: items.length });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /api/mail/receive — log incoming mail/package — staff
// ---------------------------------------------------------------------------
router.post('/receive', staffOnly, validateBody(receiveSchema), async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const tf = tenantFilter(req);
    const member = await prisma.member.findFirst({
      where: { ...tf, id: req.body.memberId },
    });
    if (!member) return res.status(404).json({ error: 'Member not found.' });

    const item = await prisma.mailItem.create({
      data: {
        tenantId,
        memberId: member.id,
        type: req.body.type || 'package',
        sender: req.body.sender || null,
        trackingNumber: req.body.trackingNumber || null,
        notes: req.body.notes || null,
        status: 'received',
      },
      include: includeItem,
    });

    // Notify the member (email + in-app), fire-and-forget
    const notifiedAt = new Date();
    notifyMember(tenantId, item, 'mailReceived').catch(() => {});
    await prisma.mailItem.update({
      where: { id: item.id },
      data: { notifiedAt, status: 'notified' },
    }).catch(() => {});

    writeAudit(req, 'mail.received', { itemId: item.id, memberId: member.id }).catch(() => {});
    emitWebhook(tenantId, 'mail.received', { itemId: item.id, memberId: member.id }).catch(() => {});

    res.status(201).json({ item: { ...item, notifiedAt, status: 'notified' } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /api/mail/:id/collect — mark collected — staff
// ---------------------------------------------------------------------------
router.post('/:id/collect', staffOnly, validateBody(collectSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const item = await prisma.mailItem.findFirst({ where: { ...tf, id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Mail item not found.' });
    if (item.status === 'collected') return res.status(409).json({ error: 'Already collected.' });

    const updated = await prisma.mailItem.update({
      where: { id: item.id },
      data: {
        status: 'collected',
        collectedAt: new Date(),
        collectedBy: req.body.collectedBy || null,
      },
      include: includeItem,
    });

    writeAudit(req, 'mail.collected', { itemId: item.id }).catch(() => {});
    emitWebhook(req.tenantId, 'mail.collected', { itemId: item.id }).catch(() => {});

    res.json({ item: updated });
  } catch (err) { next(err); }
});

module.exports = router;
