const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter, todayDateOnly } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const STAFF_PRIVILEGED = ['ceo', 'admin', 'operations_manager', 'manager'];
const isPrivileged = (role) => STAFF_PRIVILEGED.includes(role);

const leaveSchema = z
  .object({
    fromDate: z.coerce.date(),
    toDate: z.coerce.date(),
    reason: z.string().optional().nullable(),
  })
  .refine((d) => d.fromDate <= d.toDate, { message: 'fromDate must be on or before toDate' });

const decideSchema = z.object({ status: z.enum(['approved', 'rejected']) });

// ------------------------------------------------------------ attendance ---
// Check-in: upsert today's record (unique on tenantId+userId+date).
// A second check-in the same day → 400.
router.post('/check-in', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const date = todayDateOnly();

    const existing = await prisma.attendanceRecord.findFirst({
      where: { ...tf, userId: req.user.sub, date },
    });
    if (existing && existing.checkIn) {
      return res.status(400).json({ error: { message: 'Already checked in today' } });
    }
    if (existing) {
      const record = await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { checkIn: new Date() },
      });
      return res.json({ record });
    }
    const record = await prisma.attendanceRecord.create({
      data: { ...tf, userId: req.user.sub, date, checkIn: new Date() },
    });
    return res.status(201).json({ record });
  } catch (err) {
    return next(err);
  }
});

router.post('/check-out', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const record = await prisma.attendanceRecord.findFirst({
      where: { ...tf, userId: req.user.sub, date: todayDateOnly() },
    });
    if (!record || !record.checkIn) {
      return res.status(400).json({ error: { message: 'No check-in record found for today' } });
    }
    if (record.checkOut) {
      return res.status(400).json({ error: { message: 'Already checked out today' } });
    }
    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { checkOut: new Date() },
    });
    return res.json({ record: updated });
  } catch (err) {
    return next(err);
  }
});

// Records: staff see only their own unless they are privileged.
// Today's check-in status for the current user.
router.get('/status', async (req, res, next) => {
  try {
    const record = await prisma.attendanceRecord.findFirst({
      where: {
        ...tenantFilter(req),
        userId: req.user.sub,
        date: todayDateOnly(),
      },
      orderBy: { date: 'desc' },
    });
    return res.json({
      status: record
        ? { checkedIn: true, checkInAt: record.checkIn, checkOutAt: record.checkOut, record }
        : { checkedIn: false },
    });
  } catch (err) {
    return next(err);
  }
});

router.get(['/', '/records'], async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (isPrivileged(req.user.role)) {
      if (req.query.userId) where.userId = String(req.query.userId);
    } else {
      where.userId = req.user.sub;
    }
    if (req.query.date) {
      const d = new Date(String(req.query.date));
      if (!Number.isNaN(d.getTime())) where.date = d;
    }
    const records = await prisma.attendanceRecord.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
    return res.json({ records });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------------------- leaves ---
router.get('/leaves', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (!isPrivileged(req.user.role)) where.userId = req.user.sub;
    const leaves = await prisma.leave.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ leaves });
  } catch (err) {
    return next(err);
  }
});

router.post('/leaves', validateBody(leaveSchema), async (req, res, next) => {
  try {
    const leave = await prisma.leave.create({
      data: {
        ...tenantFilter(req),
        userId: req.user.sub,
        fromDate: req.body.fromDate,
        toDate: req.body.toDate,
        reason: req.body.reason || null,
      },
    });
    return res.status(201).json({ leave });
  } catch (err) {
    return next(err);
  }
});

// Decide a leave request: privileged roles only, and only pending leaves.
router.patch(
  '/leaves/:id',
  requireRole(...STAFF_PRIVILEGED),
  validateBody(decideSchema),
  async (req, res, next) => {
    try {
      const existing = await prisma.leave.findFirst({
        where: { id: req.params.id, ...tenantFilter(req) },
      });
      if (!existing) return res.status(404).json({ error: { message: 'Leave not found' } });
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: { message: 'Leave is already decided' } });
      }
      const leave = await prisma.leave.update({
        where: { id: existing.id },
        data: { status: req.body.status, decidedById: req.user.sub },
      });
      return res.json({ leave });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
