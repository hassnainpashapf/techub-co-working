const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { emitWebhook } = require('../lib/webhooks');
const { authenticateAny, requireScope } = require('../middleware/apiKey');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { invalidateTenantCache } = require('../middleware/cache');
// Phase 28: audit coverage
const { writeAudit } = require('../middleware/audit');
const auditAsync = (data) => writeAudit(data).catch(() => {});

const router = express.Router();

router.use(authenticateAny, requireTenantUser);
router.use(invalidateTenantCache);

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

router.get('/', requireScope('bookings:read'), async (req, res, next) => {
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

    // Phase 31: credit limit enforcement — block booking if member exceeded limit.
    if (finalMemberId) {
      try {
        const { checkCreditLimit } = require('../lib/credit');
        const credit = await checkCreditLimit(tf.tenantId, finalMemberId);
        if (credit.exceeded) {
          return res.status(402).json({
            error: {
              message: `Credit limit exceeded. Outstanding Rs ${credit.balance.toLocaleString()} vs limit Rs ${credit.limit.toLocaleString()}. Please clear dues to book.`,
              code: 'CREDIT_LIMIT_EXCEEDED',
              balance: credit.balance,
              limit: credit.limit,
            },
          });
        }
      } catch (err) {
        if (err.status === 402) throw err;
        // checkCreditLimit throws 400 for unknown member — member already validated above.
        // Any other failure: fail open (don't block booking on credit-check errors).
      }
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
    emitWebhook(tf.tenantId, 'booking.created', { id: booking.id, title: booking.title, unitCode: booking.unit?.code, startAt: booking.startAt, endAt: booking.endAt });
    auditAsync({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'booking.create', entity: 'Booking', entityId: booking.id, newValue: { title: booking.title }, ip: req.ip, userAgent: req.headers['user-agent'] });
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
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'booking.update', entity: 'Booking', entityId: booking.id, ip: req.ip, userAgent: req.headers['user-agent'] });
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
    emitWebhook(req.user.tenantId, 'booking.cancelled', { id: booking.id, title: booking.title });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'booking.cancel', entity: 'Booking', entityId: booking.id, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.json({ booking });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
