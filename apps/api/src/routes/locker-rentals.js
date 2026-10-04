// Phase 56 Track 2: Locker Rentals
// MOUNT: app.use('/api/locker-rentals', require('./routes/locker-rentals'));
// server.js / Sidebar.js nahi chhue — lockers section extend hai.
//
// LOCKER PAGE INTEGRATION NOTE (coordinator / Track 1 locker page):
//   Locker list row par Rent/Return actions:
//   - Rent:    POST /api/locker-rentals { lockerId, memberId, monthlyRate?, months?, autoRenew? }
//   - Return:  POST /api/locker-rentals/:id/release
//   - Renew:   POST /api/locker-rentals/:id/renew { months }
//   Member portal: meri rentals ke liye GET /api/locker-rentals/me, cancel ke liye POST /api/locker-rentals/me/:id/cancel
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'reception'];
const STATUSES = ['active', 'expired', 'cancelled'];

function schemaLive() {
  return !!(prisma && prisma.lockerRental);
}
function guard503(req, res, next) {
  if (!schemaLive()) return res.status(503).json({ error: 'Locker rentals schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'LockerRental', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// Locker asal me khali hai? (active rental na ho)
async function lockerAvailable(tf, lockerId, excludeRentalId) {
  return !(await prisma.lockerRental.findFirst({
    where: {
      ...tf,
      lockerId,
      status: 'active',
      ...(excludeRentalId ? { id: { not: excludeRentalId } } : {}),
    },
  }));
}

function rentalPayload() {
  return {
    include: {
      member: { select: { id: true, name: true, email: true } },
      ...(prisma.locker ? { locker: true } : {}),
    },
  };
}

// ---------- MEMBER ----------

// POST /request — member locker request kare (khud ka)
router.post(
  '/request',
  validateBody(z.object({
    lockerId: z.string().min(1).optional(),
    months: z.number().int().min(1).max(36).optional(),
  })),
  async (req, res) => {
    try {
      const tf = tenantFilter(req);
      if (!req.user.memberId) return res.status(403).json({ error: 'Linked member profile required' });

      let lockerId = req.body.lockerId;
      let monthlyRate = '0';
      if (lockerId) {
        const locker = prisma.locker ? await prisma.locker.findFirst({ where: { ...tf, id: lockerId } }) : null;
        if (!locker) return res.status(404).json({ error: 'Locker not found' });
        if (!(await lockerAvailable(tf, lockerId))) {
          return res.status(409).json({ error: 'Locker already rented' });
        }
        monthlyRate = String(locker.monthlyRate ?? 0);
      }
      if (!lockerId && prisma.locker) {
        // Pehla khali locker auto-assign
        const rentedIds = await prisma.lockerRental.findMany({
          where: { ...tf, status: 'active' }, select: { lockerId: true },
        });
        const busy = new Set(rentedIds.map((r) => r.lockerId));
        const free = await prisma.locker.findFirst({
          where: { ...tf, status: 'available', id: { notIn: [...busy] } },
          orderBy: { code: 'asc' },
        });
        if (!free) return res.status(409).json({ error: 'No lockers available' });
        lockerId = free.id;
        monthlyRate = String(free.monthlyRate ?? 0);
      }
      if (!lockerId) return res.status(422).json({ error: 'lockerId required' });

      const months = req.body.months || 1;
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + months);
      const rental = await prisma.lockerRental.create({
        data: {
          ...tf,
          lockerId,
          memberId: req.user.memberId,
          monthlyRate,
          endDate,
        },
        ...rentalPayload(),
      });
      if (prisma.locker) {
        await prisma.locker.update({ where: { id: lockerId }, data: { status: 'occupied' } }).catch(() => {});
      }
      audit(req, tf, 'locker_rental.request', rental.id, { lockerId, months });
      return res.status(201).json({ rental });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to request locker' });
    }
  }
);

// GET /me — meri rentals
router.get('/me', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!req.user.memberId) return res.status(403).json({ error: 'Linked member profile required' });
    const rentals = await prisma.lockerRental.findMany({
      where: { ...tf, memberId: req.user.memberId },
      orderBy: { createdAt: 'desc' },
      ...rentalPayload(),
    });
    return res.json({ rentals });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load rentals' });
  }
});

// POST /me/:id/cancel — apni active rental cancel
router.post('/me/:id/cancel', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!req.user.memberId) return res.status(403).json({ error: 'Linked member profile required' });
    const rental = await prisma.lockerRental.findFirst({ where: { ...tf, id: req.params.id, memberId: req.user.memberId } });
    if (!rental) return res.status(404).json({ error: 'Rental not found' });
    if (rental.status !== 'active') return res.status(409).json({ error: 'Only active rentals can be cancelled' });
    const updated = await prisma.lockerRental.update({
      where: { id: rental.id },
      data: { status: 'cancelled', endDate: new Date() },
    });
    audit(req, tf, 'locker_rental.cancel', rental.id, null);
    return res.json({ rental: updated });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to cancel rental' });
  }
});

// ---------- STAFF ----------

// GET / — list (filters: status, memberId, lockerId)
router.get('/', requireRole(...STAFF), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { status, memberId, lockerId } = req.query;
    const where = { ...tf };
    if (status && STATUSES.includes(status)) where.status = status;
    if (memberId) where.memberId = memberId;
    if (lockerId) where.lockerId = lockerId;
    const rentals = await prisma.lockerRental.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200, ...rentalPayload(),
    });
    const counts = {};
    for (const s of STATUSES) counts[s] = await prisma.lockerRental.count({ where: { ...tf, status: s } });
    return res.json({ rentals, counts });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load rentals' });
  }
});

// GET /:id
router.get('/:id', requireRole(...STAFF), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const rental = await prisma.lockerRental.findFirst({ where: { ...tf, id: req.params.id }, ...rentalPayload() });
    if (!rental) return res.status(404).json({ error: 'Rental not found' });
    return res.json({ rental });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load rental' });
  }
});

// POST / — staff locker assign kare
router.post(
  '/',
  requireRole(...STAFF),
  validateBody(z.object({
    lockerId: z.string().min(1),
    memberId: z.string().min(1),
    monthlyRate: z.number().min(0).max(1000000).optional(),
    months: z.number().int().min(1).max(36).optional(),
    autoRenew: z.boolean().optional(),
  })),
  async (req, res) => {
    try {
      const tf = tenantFilter(req);
      const { lockerId, memberId } = req.body;
      const member = await prisma.member.findFirst({ where: { ...tf, id: memberId } });
      if (!member) return res.status(404).json({ error: 'Member not found' });
      const locker = prisma.locker ? await prisma.locker.findFirst({ where: { ...tf, id: lockerId } }) : null;
      if (!locker) return res.status(404).json({ error: 'Locker not found' });
      if (!(await lockerAvailable(tf, lockerId))) return res.status(409).json({ error: 'Locker already rented' });

      const months = req.body.months || 1;
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + months);
      const rental = await prisma.lockerRental.create({
        data: {
          ...tf,
          lockerId,
          memberId,
          monthlyRate: String(req.body.monthlyRate ?? locker.monthlyRate ?? 0),
          endDate,
          autoRenew: req.body.autoRenew ?? true,
        },
        ...rentalPayload(),
      });
      await prisma.locker.update({ where: { id: lockerId }, data: { status: 'occupied' } }).catch(() => {});
      audit(req, tf, 'locker_rental.assign', rental.id, { lockerId, memberId });
      return res.status(201).json({ rental });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to assign locker' });
    }
  }
);

// PATCH /:id — rate / autoRenew / endDate edit
router.patch(
  '/:id',
  requireRole(...STAFF),
  validateBody(z.object({
    monthlyRate: z.number().min(0).max(1000000).optional(),
    autoRenew: z.boolean().optional(),
    endDate: z.string().datetime().optional(),
  })),
  async (req, res) => {
    try {
      const tf = tenantFilter(req);
      const rental = await prisma.lockerRental.findFirst({ where: { ...tf, id: req.params.id } });
      if (!rental) return res.status(404).json({ error: 'Rental not found' });
      const data = {};
      if (req.body.monthlyRate !== undefined) data.monthlyRate = String(req.body.monthlyRate);
      if (req.body.autoRenew !== undefined) data.autoRenew = req.body.autoRenew;
      if (req.body.endDate) data.endDate = new Date(req.body.endDate);
      const updated = await prisma.lockerRental.update({ where: { id: rental.id }, data, ...rentalPayload() });
      audit(req, tf, 'locker_rental.update', rental.id, data);
      return res.json({ rental: updated });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to update rental' });
    }
  }
);

// POST /:id/renew — endDate months aage barhao (active rahe)
router.post(
  '/:id/renew',
  requireRole(...STAFF),
  validateBody(z.object({ months: z.number().int().min(1).max(36).optional() })),
  async (req, res) => {
    try {
      const tf = tenantFilter(req);
      const rental = await prisma.lockerRental.findFirst({ where: { ...tf, id: req.params.id } });
      if (!rental) return res.status(404).json({ error: 'Rental not found' });
      if (rental.status !== 'active') return res.status(409).json({ error: 'Only active rentals can be renewed' });
      const months = req.body.months || 1;
      const base = rental.endDate && rental.endDate > new Date() ? new Date(rental.endDate) : new Date();
      base.setMonth(base.getMonth() + months);
      const updated = await prisma.lockerRental.update({
        where: { id: rental.id }, data: { endDate: base }, ...rentalPayload(),
      });
      audit(req, tf, 'locker_rental.renew', rental.id, { months, endDate: base });
      return res.json({ rental: updated });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to renew rental' });
    }
  }
);

// POST /:id/release — locker wapas (rental cancelled, locker khali)
router.post('/:id/release', requireRole(...STAFF), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const rental = await prisma.lockerRental.findFirst({ where: { ...tf, id: req.params.id } });
    if (!rental) return res.status(404).json({ error: 'Rental not found' });
    if (rental.status !== 'active') return res.status(409).json({ error: 'Only active rentals can be released' });
    const updated = await prisma.lockerRental.update({
      where: { id: rental.id },
      data: { status: 'cancelled', endDate: new Date() },
      ...rentalPayload(),
    });
    // Locker wapas available
    if (prisma.locker) {
      await prisma.locker.update({ where: { id: rental.lockerId }, data: { status: 'available' } }).catch(() => {});
    }
    audit(req, tf, 'locker_rental.release', rental.id, null);
    return res.json({ rental: updated });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to release locker' });
  }
});

module.exports = router;
