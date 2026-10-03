const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const PRIVILEGED = ['ceo', 'admin', 'operations_manager', 'manager', 'receptionist'];
const isPrivileged = (role) => PRIVILEGED.includes(role);

const bookingSchema = z
  .object({
    unitId: z.string().min(1),
    memberId: z.string().optional().nullable(),
    title: z.string().min(1),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
  })
  .refine((d) => d.endAt > d.startAt, { message: 'endAt must be after startAt' });

const bookingUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    memberId: z.string().optional().nullable(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

const includeBooking = {
  unit: { select: { id: true, code: true, type: true } },
  member: { select: { id: true, name: true } },
};

function bookingScope(req) {
  const where = { ...tenantFilter(req) };
  // Member portal: own bookings only.
  if (req.user.role === 'member') where.memberId = req.user.memberId;
  return where;
}

// Overlap check: another CONFIRMED booking on the same unit whose interval
// intersects [startAt, endAt): startAt < newEnd && endAt > newStart.
// Touching edges (endAt === newStart) are allowed — not an overlap.
async function findOverlap(tenantId, unitId, startAt, endAt, excludeId = null) {
  const where = {
    tenantId,
    unitId,
    status: 'confirmed',
    startAt: { lt: endAt },
    endAt: { gt: startAt },
  };
  if (excludeId) where.id = { not: excludeId };
  return prisma.booking.findFirst({ where });
}

router.get('/', async (req, res, next) => {
  try {
    const where = bookingScope(req);
    if (req.query.unitId) where.unitId = String(req.query.unitId);
    if (req.query.from && req.query.to) {
      // Calendar range: bookings overlapping [from, to)
      const from = new Date(String(req.query.from));
      const to = new Date(String(req.query.to));
      where.startAt = { lt: to };
      where.endAt = { gt: from };
    } else {
      if (req.query.from) where.startAt = { ...(where.startAt || {}), gte: new Date(String(req.query.from)) };
      if (req.query.to) where.endAt = { ...(where.endAt || {}), lte: new Date(String(req.query.to)) };
    }
    const bookings = await prisma.booking.findMany({
      where,
      include: includeBooking,
      orderBy: { startAt: 'asc' },
    });
    return res.json({ bookings });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(bookingSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { unitId, memberId, title, startAt, endAt } = req.body;

    const unit = await prisma.unit.findFirst({ where: { id: unitId, ...tf } });
    if (!unit) return res.status(400).json({ error: { message: 'Unit not found' } });

    // Member role: bookings are forced onto their own member record.
    let finalMemberId = memberId || null;
    if (req.user.role === 'member') {
      finalMemberId = req.user.memberId;
      if (!finalMemberId) {
        return res.status(403).json({ error: { message: 'Member record required' } });
      }
    } else if (finalMemberId) {
      const member = await prisma.member.findFirst({ where: { id: finalMemberId, ...tf } });
      if (!member) return res.status(400).json({ error: { message: 'Member not found' } });
    }

    const clash = await findOverlap(tf.tenantId, unitId, startAt, endAt);
    if (clash) {
      return res.status(409).json({
        error: { message: 'This time slot is already booked' },
      });
    }

    const booking = await prisma.booking.create({
      data: {
        ...tf,
        unitId,
        memberId: finalMemberId,
        title,
        startAt,
        endAt,
        createdById: req.user.sub,
      },
      include: {
        ...includeBooking,
        member: { select: { id: true, name: true, email: true } },
      },
    });
    // Email notification (non-blocking)
    if (booking.member?.email) {
      const { notify } = require('../lib/mailer');
      notify(tf.tenantId, booking.member.email, 'bookingConfirmed', {
        memberName: booking.member.name,
        unitCode: booking.unit?.code,
        date: new Date(booking.startAt).toLocaleDateString(),
        startTime: new Date(booking.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }).catch(() => {});
    }
    return res.status(201).json({ booking });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', validateBody(bookingUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.booking.findFirst({
      where: { id: req.params.id, ...bookingScope(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Booking not found' } });
    if (
      !isPrivileged(req.user.role) &&
      existing.createdById !== req.user.sub &&
      existing.memberId !== req.user.memberId
    ) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    const startAt = req.body.startAt || existing.startAt;
    const endAt = req.body.endAt || existing.endAt;
    if (endAt <= startAt) {
      return res.status(400).json({ error: { message: 'endAt must be after startAt' } });
    }
    const clash = await findOverlap(req.user.tenantId, existing.unitId, startAt, endAt, existing.id);
    if (clash) {
      return res.status(409).json({ error: { message: 'This time slot is already booked' } });
    }

    const booking = await prisma.booking.update({
      where: { id: existing.id },
      data: req.body,
      include: includeBooking,
    });
    return res.json({ booking });
  } catch (err) {
    return next(err);
  }
});

// Soft delete: mark cancelled, keep history.
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.booking.findFirst({
      where: { id: req.params.id, ...bookingScope(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Booking not found' } });
    if (
      !isPrivileged(req.user.role) &&
      existing.createdById !== req.user.sub &&
      existing.memberId !== req.user.memberId
    ) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    const booking = await prisma.booking.update({
      where: { id: existing.id },
      data: { status: 'cancelled' },
      include: includeBooking,
    });
    return res.json({ booking });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
