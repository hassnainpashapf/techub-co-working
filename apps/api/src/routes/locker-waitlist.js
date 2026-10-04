// Phase 56 Track 6: Locker Waitlist.
// Mount (coordinator): app.use('/api/locker-waitlist', require('./routes/locker-waitlist'));
// Sidebar link nahi — lockers section extend hai.
// Lockers page integration note (coordinator/track owning lockers page):
//   - Waitlist tab: `GET /api/locker-waitlist` (staff) — status/size filters.
//   - "Offer" button: `POST /api/locker-waitlist/:id/offer { lockerCode?, notes? }`.
//   - Member portal: "Join waitlist" -> `POST /api/locker-waitlist { size }`,
//     "Leave" -> `DELETE /api/locker-waitlist/me` (ya `POST /me/decline`).

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);
const STAFF = requireRole('ceo', 'admin', 'super_admin', 'manager', 'reception');

// Model merge na hua ho to 503 (koi 500 nahi).
router.use((req, res, next) => {
  if (!prisma.lockerWaitlist) return res.status(503).json({ error: 'Locker waitlist schema not deployed yet' });
  next();
});

const SIZE = z.enum(['S', 'M', 'L', 'XL']);
const STATUS = z.enum(['waiting', 'offered', 'declined']);

const joinSchema = z.object({ size: SIZE.default('M'), notes: z.string().max(500).optional().nullable() });
const offerSchema = z.object({ lockerCode: z.string().max(40).optional().nullable(), notes: z.string().max(500).optional().nullable() });

async function myMember(req) {
  if (!req.user.memberId) return null;
  return prisma.member.findFirst({ where: { id: req.user.memberId, ...tenantFilter(req) } });
}

// ---------- Member ----------

// POST /api/locker-waitlist — waitlist me shamil ho
router.post('/', async (req, res, next) => {
  try {
    const member = await myMember(req);
    if (!member) return res.status(403).json({ error: 'Member profile required' });
    const body = joinSchema.parse(req.body || {});
    const existing = await prisma.lockerWaitlist.findFirst({
      where: { ...tenantFilter(req), memberId: member.id, status: { in: ['waiting', 'offered'] } },
    });
    if (existing) return res.status(409).json({ error: 'Already on the waitlist', entry: existing });
    const entry = await prisma.lockerWaitlist.create({
      data: { ...tenantFilter(req), memberId: member.id, size: body.size, notes: body.notes ?? null },
    });
    await writeAudit(req, { action: 'locker_waitlist.join', entity: 'LockerWaitlist', entityId: entry.id, newValue: { size: body.size } }).catch(() => {});
    return res.status(201).json({ entry });
  } catch (e) {
    if (e && e.name === 'ZodError') return res.status(422).json({ error: 'Validation failed', issues: e.issues });
    return next(e);
  }
});

// GET /api/locker-waitlist/me — meri entries
router.get('/me', async (req, res, next) => {
  try {
    const member = await myMember(req);
    if (!member) return res.status(403).json({ error: 'Member profile required' });
    const entries = await prisma.lockerWaitlist.findMany({
      where: { ...tenantFilter(req), memberId: member.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ entries });
  } catch (e) { next(e); }
});

// DELETE /api/locker-waitlist/me — waitlist se niklo
router.delete('/me', async (req, res, next) => {
  try {
    const member = await myMember(req);
    if (!member) return res.status(403).json({ error: 'Member profile required' });
    await prisma.lockerWaitlist.deleteMany({
      where: { ...tenantFilter(req), memberId: member.id, status: { in: ['waiting', 'offered'] } },
    });
    await writeAudit(req, { action: 'locker_waitlist.leave', entity: 'LockerWaitlist', entityId: member.id }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Staff ----------

// GET /api/locker-waitlist — list (staff)
router.get('/', STAFF, async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.size) where.size = String(req.query.size);
    const entries = await prisma.lockerWaitlist.findMany({
      where,
      include: { member: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Number(req.query.limit) || 100, 500),
    });
    const counts = await prisma.lockerWaitlist.groupBy({
      by: ['status'], where: tenantFilter(req), _count: { _all: true },
    });
    res.json({ entries, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) });
  } catch (e) { next(e); }
});

// POST /api/locker-waitlist/:id/offer — locker offer karo + member ko notify (staff)
router.post('/:id/offer', STAFF, async (req, res, next) => {
  try {
    const body = offerSchema.parse(req.body || {});
    const entry = await prisma.lockerWaitlist.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { member: { include: { user: { select: { id: true } } } } },
    });
    if (!entry) return res.status(404).json({ error: 'Waitlist entry not found' });
    if (entry.status !== 'waiting') return res.status(409).json({ error: `Cannot offer — entry is ${entry.status}` });

    const updated = await prisma.lockerWaitlist.update({
      where: { id: entry.id },
      data: { status: 'offered', notes: body.notes ?? entry.notes },
    });

    const lockerRef = body.lockerCode ? ` — Locker ${body.lockerCode}` : '';
    const userId = entry.member?.user?.id || null;
    if (userId) {
      await prisma.notification.create({
        data: {
          tenantId: req.user.tenantId,
          userId,
          type: 'general',
          message: `Good news! A locker (size ${entry.size})${lockerRef} is available for you. Please contact reception to claim it.`,
        },
      }).catch(() => {});
    }

    await writeAudit(req, {
      action: 'locker_waitlist.offer', entity: 'LockerWaitlist', entityId: entry.id,
      newValue: { memberId: entry.memberId, lockerCode: body.lockerCode ?? null },
    }).catch(() => {});
    res.json({ entry: updated, notified: !!userId });
  } catch (e) {
    if (e && e.name === 'ZodError') return res.status(422).json({ error: 'Validation failed', issues: e.issues });
    return next(e);
  }
});

// PATCH /api/locker-waitlist/:id — status update (staff)
router.patch('/:id', STAFF, async (req, res, next) => {
  try {
    const body = z.object({ status: STATUS, notes: z.string().max(500).optional().nullable() }).parse(req.body || {});
    const entry = await prisma.lockerWaitlist.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!entry) return res.status(404).json({ error: 'Waitlist entry not found' });
    const updated = await prisma.lockerWaitlist.update({
      where: { id: entry.id },
      data: { status: body.status, notes: body.notes ?? entry.notes },
    });
    await writeAudit(req, {
      action: 'locker_waitlist.status', entity: 'LockerWaitlist', entityId: entry.id,
      oldValue: { status: entry.status }, newValue: { status: body.status },
    }).catch(() => {});
    res.json({ entry: updated });
  } catch (e) {
    if (e && e.name === 'ZodError') return res.status(422).json({ error: 'Validation failed', issues: e.issues });
    return next(e);
  }
});

module.exports = router;
