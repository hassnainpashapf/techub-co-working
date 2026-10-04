// Phase 56 Track 4: Locker Access Codes.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/locker-codes', require('./routes/locker-codes'));
//
// Lockers extend — sidebar link nahi (lockers page me "🔐 Code" action jorein):
//   Staff (manager/admin/ceo/super_admin):
//     GET  /                              -> codes (metadata only, hash kabhi nahi) ?lockerId=
//     POST /issue { lockerId, expiresAt? } -> { code, pin } (PIN sirf ek dafa plain)
//     POST /:id/rotate                     -> { code, pin } (naya PIN, purana auto-deactivate)
//     PATCH /:id/deactivate                -> code band karein
//   Member (koi bhi tenant user, apne rented lockers ke liye):
//     GET  /me                             -> mere lockers + code status (active/expired/hasCode)
//     POST /me/request { lockerId }         -> apne locker ka NAYA code lein, PIN ek dafa plain
//       (PIN hashed store hota hai — bhool jayein to yehi self-service flow dubara code deta hai)
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const {
  modelReady,
  publicCode,
  issueLockerCode,
  rotateLockerCode,
  deactivateLockerCode,
} = require('../lib/lockerCodes');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['manager', 'admin', 'ceo', 'super_admin'];

function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'locker-codes migration pending' });
  next();
}

async function tenantLocker(req, lockerId) {
  const tf = tenantFilter(req);
  if (!prisma.locker?.findFirst) return null;
  return prisma.locker.findFirst({ where: { id: lockerId, ...tf } });
}

// ---- Member self-service routes (staff guard se pehle, taake member bhi aa sake) ----

// GET /me — mere active rented lockers + un ke code ka status (PIN hash ki wajah se plain nahi dikh sakta)
router.get('/me', guard, async (req, res) => {
  try {
    if (!req.user.memberId) return res.status(400).json({ error: 'member profile linked nahi' });
    if (typeof prisma.lockerRental?.findMany !== 'function') {
      return res.status(503).json({ error: 'locker-rentals migration pending' });
    }
    const tf = tenantFilter(req);
    const rentals = await prisma.lockerRental.findMany({
      where: { ...tf, memberId: req.user.memberId, status: 'active' },
      include: { locker: true },
    });
    const lockerIds = rentals.map((r) => r.lockerId);
    const codes = await prisma.lockerCode.findMany({
      where: { ...tf, lockerId: { in: lockerIds }, isActive: true },
    });
    const byLocker = Object.fromEntries(codes.map((c) => [c.lockerId, c]));
    res.json({
      lockers: rentals.map((r) => {
        const c = byLocker[r.lockerId];
        const exp = c?.expiresAt ? new Date(c.expiresAt) : null;
        return {
          lockerId: r.lockerId,
          lockerCode: r.locker?.code || null,
          location: r.locker?.location || null,
          hasCode: !!c,
          codeActive: !!c && !(exp && exp < new Date()),
          codeExpired: !!c && !!(exp && exp < new Date()),
          expiresAt: c?.expiresAt || null,
          issuedAt: c?.issuedAt || null,
        };
      }),
      note: 'PIN hashed store hota hai — code dekhne/bhoolne par POST /me/request se naya code lein',
    });
  } catch (e) {
    res.status(500).json({ error: 'my lockers failed' });
  }
});

// POST /me/request — member apne rented locker ka naya PIN le (PIN sirf is response me plain)
router.post('/me/request', guard, async (req, res) => {
  try {
    if (!req.user.memberId) return res.status(400).json({ error: 'member profile linked nahi' });
    if (typeof prisma.lockerRental?.findMany !== 'function') {
      return res.status(503).json({ error: 'locker-rentals migration pending' });
    }
    const body = z.object({ lockerId: z.string().min(1) }).parse(req.body);
    const tf = tenantFilter(req);
    const rental = await prisma.lockerRental.findFirst({
      where: { ...tf, memberId: req.user.memberId, lockerId: body.lockerId, status: 'active' },
      include: { locker: true },
    });
    if (!rental) return res.status(404).json({ error: 'apke paas is locker ka active rental nahi' });
    const { code, pin } = await issueLockerCode(tf.tenantId, body.lockerId, {
      issuedBy: req.user.id,
    });
    await writeAudit(req, {
      action: 'locker-code.member_request',
      entity: 'locker_code',
      entityId: code.id,
      newValue: { lockerId: body.lockerId, selfService: true },
    });
    res.status(201).json({
      code: publicCode(code),
      locker: rental.locker?.code || null,
      pin,
      warning: 'PIN sirf ek dafa dikhaya jata hai — abhi note kar lein',
    });
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid input' });
    res.status(500).json({ error: 'request failed' });
  }
});

// ---- Staff routes ----
const staff = express.Router();
staff.use(requireRole(...STAFF));

// GET / — codes list (?lockerId= filter), metadata only
staff.get('/', guard, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.lockerId) where.lockerId = String(req.query.lockerId);
    const rows = await prisma.lockerCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    let lockers = {};
    if (prisma.locker?.findMany) {
      const ls = await prisma.locker.findMany({
        where: { ...tf, id: { in: rows.map((r) => r.lockerId) } },
        select: { id: true, code: true },
      });
      lockers = Object.fromEntries(ls.map((l) => [l.id, l.code]));
    }
    res.json({ codes: rows.map((c) => ({ ...publicCode(c), locker: lockers[c.lockerId] || null })) });
  } catch (e) {
    res.status(500).json({ error: 'list failed' });
  }
});

// POST /issue — locker ko naya PIN (purana active auto-deactivate). PIN sirf is response me plain.
staff.post('/issue', guard, async (req, res) => {
  try {
    const body = z.object({
      lockerId: z.string().min(1),
      expiresAt: z.string().datetime().optional().nullable(),
    }).parse(req.body);
    const locker = await tenantLocker(req, body.lockerId);
    if (!locker) return res.status(404).json({ error: 'locker not found' });
    const tf = tenantFilter(req);
    const { code, pin } = await issueLockerCode(tf.tenantId, body.lockerId, {
      expiresAt: body.expiresAt,
      issuedBy: req.user.id,
    });
    await writeAudit(req, {
      action: 'locker-code.issue',
      entity: 'locker_code',
      entityId: code.id,
      newValue: { lockerId: body.lockerId, locker: locker.code }, // PIN hash/value kabhi audit me nahi
    });
    res.status(201).json({
      code: { ...publicCode(code), locker: locker.code },
      pin,
      warning: 'PIN sirf ek dafa dikhaya jata hai — member ko abhi note karwa lein',
    });
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid input' });
    res.status(500).json({ error: 'issue failed' });
  }
});

// POST /:id/rotate — isi locker ka naya PIN
staff.post('/:id/rotate', guard, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.lockerCode.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'code not found' });
    const { code, pin } = await rotateLockerCode(existing.tenantId, existing.lockerId, {
      expiresAt: existing.expiresAt,
      issuedBy: req.user.id,
    });
    await writeAudit(req, {
      action: 'locker-code.rotate',
      entity: 'locker_code',
      entityId: code.id,
      newValue: { lockerId: existing.lockerId },
    });
    res.status(201).json({
      code: publicCode(code),
      pin,
      warning: 'PIN sirf ek dafa dikhaya jata hai — member ko abhi note karwa lein',
    });
  } catch (e) {
    res.status(500).json({ error: 'rotate failed' });
  }
});

// PATCH /:id/deactivate — code band karein (locker release/maintenance)
staff.patch('/:id/deactivate', guard, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.lockerCode.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'code not found' });
    await deactivateLockerCode(existing.tenantId, existing.lockerId);
    await writeAudit(req, {
      action: 'locker-code.deactivate',
      entity: 'locker_code',
      entityId: existing.id,
      newValue: { lockerId: existing.lockerId },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'deactivate failed' });
  }
});

router.use(staff);

module.exports = router;
