// Phase 26: Member self-service portal API — members can ONLY see their own data.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { emitWebhook } = require('../lib/webhooks');

const router = express.Router();

router.use(authenticate, requireTenantUser);

// Only member-role users may use the portal endpoints.
router.use((req, res, next) => {
  if (req.user.role !== 'member') {
    return res.status(403).json({ error: { message: 'Member portal access only.' } });
  }
  return next();
});

// Resolve the member record for the logged-in user: memberId from JWT,
// falling back to email match.
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

// GET /api/portal/overview — profile, active contract, upcoming bookings, open tickets, unpaid total
router.get('/overview', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });

    const now = new Date();
    const [contract, bookings, tickets, invoices] = await Promise.all([
      prisma.contract.findFirst({
        where: { memberId: member.id, status: 'active', ...tf },
        include: { unit: { select: { id: true, code: true, type: true } } },
        orderBy: { startDate: 'desc' },
      }),
      prisma.booking.findMany({
        where: { memberId: member.id, startAt: { gte: now }, ...tf },
        include: { unit: { select: { id: true, code: true, type: true } } },
        orderBy: { startAt: 'asc' },
        take: 5,
      }),
      prisma.ticket.findMany({
        where: { memberId: member.id, status: { in: ['open', 'in_progress', 'pending'] }, ...tf },
        select: { id: true, ticketNumber: true, title: true, status: true, priority: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.invoice.findMany({
        where: { memberId: member.id, status: { in: ['unpaid', 'partial'] }, ...tf },
        select: { amount: true, amountPaid: true },
      }),
    ]);

    const unpaidTotal = invoices.reduce(
      (sum, i) => sum + Number(i.amount) - Number(i.amountPaid),
      0
    );

    return res.json({
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        companyName: member.companyName,
        status: member.status,
      },
      contract,
      upcomingBookings: bookings,
      openTickets: tickets,
      unpaidTotal,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/portal/invoices — my invoices with payment status
router.get('/invoices', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    const invoices = await prisma.invoice.findMany({
      where: { memberId: member.id, ...tf },
      orderBy: { dueDate: 'desc' },
    });
    return res.json({ invoices });
  } catch (err) {
    return next(err);
  }
});

// GET /api/portal/bookings — my bookings (past + upcoming)
router.get('/bookings', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    const where = { memberId: member.id, ...tf };
    if (req.query.upcoming === '1') where.startAt = { gte: new Date() };
    if (req.query.past === '1') where.endAt = { lt: new Date() };
    const bookings = await prisma.booking.findMany({
      where,
      include: { unit: { select: { id: true, code: true, type: true } } },
      orderBy: { startAt: 'desc' },
    });
    return res.json({ bookings });
  } catch (err) {
    return next(err);
  }
});

// Overlap check (same rule as bookings.js)
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

const portalBookingSchema = z
  .object({
    unitId: z.string().min(1),
    title: z.string().min(1),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
  })
  .refine((d) => d.endAt > d.startAt, { message: 'endAt must be after startAt' });

// POST /api/portal/bookings — member creates own booking (memberId forced)
router.post('/bookings', validateBody(portalBookingSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(403).json({ error: { message: 'Member record required.' } });

    const { unitId, title, startAt, endAt } = req.body;
    const unit = await prisma.unit.findFirst({ where: { id: unitId, ...tf } });
    if (!unit) return res.status(400).json({ error: { message: 'Unit not found.' } });

    const clash = await findOverlap(tf.tenantId, unitId, startAt, endAt);
    if (clash) {
      return res.status(409).json({ error: { message: 'This time slot is already booked.' } });
    }

    const booking = await prisma.booking.create({
      data: {
        ...tf,
        unitId,
        memberId: member.id,
        title,
        startAt,
        endAt,
        status: 'confirmed',
        createdById: req.user.sub,
      },
      include: { unit: { select: { id: true, code: true, type: true } } },
    });

    emitWebhook(tf.tenantId, 'booking.created', {
      bookingId: booking.id,
      unitCode: booking.unit?.code,
      memberId: member.id,
    }).catch(() => {});

    if (member.email) {
      const { notify } = require('../lib/mailer');
      notify(tf.tenantId, member.email, 'bookingConfirmed', {
        memberName: member.name,
        unitCode: booking.unit?.code,
        date: new Date(booking.startAt).toLocaleDateString(),
        startTime: new Date(booking.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }).catch(() => {});
    }

    // Phase 28: audit (fire-and-forget)
    const { writeAudit } = require('../middleware/audit');
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'portal.booking.create',
      entity: 'Booking', entityId: booking.id, newValue: { unitId: booking.unitId },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.status(201).json({ booking });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/portal/bookings/:id — cancel own upcoming booking
router.delete('/bookings/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(403).json({ error: { message: 'Member record required.' } });
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, memberId: member.id, ...tf },
    });
    if (!booking) return res.status(404).json({ error: { message: 'Booking not found.' } });
    if (new Date(booking.startAt) < new Date()) {
      return res.status(400).json({ error: { message: 'Past bookings cannot be cancelled.' } });
    }
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'cancelled' },
    });
    emitWebhook(tf.tenantId, 'booking.cancelled', { bookingId: booking.id }).catch(() => {});
    // Phase 28: audit (fire-and-forget)
    const { writeAudit } = require('../middleware/audit');
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'portal.booking.cancel',
      entity: 'Booking', entityId: booking.id,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ booking: updated });
  } catch (err) {
    return next(err);
  }
});

// POST /api/portal/bookings/:id/check-in — member checks into own booking (Phase 37).
// No migration: uses the free-form status field ('checked_in').
router.post('/bookings/:id/check-in', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(403).json({ error: { message: 'Member record required.' } });
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, memberId: member.id, ...tf },
    });
    if (!booking) return res.status(404).json({ error: { message: 'Booking not found.' } });
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: { message: 'Cancelled bookings cannot be checked in.' } });
    }
    if (booking.status === 'checked_in') {
      return res.json({ booking });
    }
    // Only on the booking day (local date comparison, generous window).
    const now = new Date();
    const start = new Date(booking.startAt);
    const sameDay =
      now.getFullYear() === start.getFullYear() &&
      now.getMonth() === start.getMonth() &&
      now.getDate() === start.getDate();
    if (!sameDay) {
      return res.status(400).json({ error: { message: 'Check-in is only available on the booking day.' } });
    }
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'checked_in' },
    });
    emitWebhook(tf.tenantId, 'booking.checked_in', { bookingId: booking.id }).catch(() => {});
    const { writeAudit } = require('../middleware/audit');
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'portal.booking.checkin',
      entity: 'Booking', entityId: booking.id,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ booking: updated });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/portal/bookings/:id — reschedule own upcoming confirmed booking (Phase 37)
const portalRescheduleSchema = z
  .object({
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
  })
  .refine((d) => d.endAt > d.startAt, { message: 'endAt must be after startAt' });

router.put('/bookings/:id', validateBody(portalRescheduleSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(403).json({ error: { message: 'Member record required.' } });
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, memberId: member.id, ...tf },
    });
    if (!booking) return res.status(404).json({ error: { message: 'Booking not found.' } });
    if (booking.status !== 'confirmed') {
      return res.status(400).json({ error: { message: 'Only confirmed bookings can be rescheduled.' } });
    }
    if (new Date(booking.startAt) < new Date()) {
      return res.status(400).json({ error: { message: 'Past bookings cannot be rescheduled.' } });
    }
    const { startAt, endAt } = req.body;
    // Phase 34 booking rules (buffer / max duration / notice / advance window)
    const { validateBookingRules } = require('../lib/bookingRules');
    const rules = await validateBookingRules({
      tenantId: tf.tenantId, unitId: booking.unitId, startAt, endAt, excludeId: booking.id,
    });
    if (!rules.valid) {
      return res.status(422).json({ error: { message: rules.message, code: rules.code } });
    }
    const clash = await findOverlap(tf.tenantId, booking.unitId, startAt, endAt, booking.id);
    if (clash) {
      return res.status(409).json({ error: { message: 'This time slot is already booked.' } });
    }
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { startAt, endAt },
      include: { unit: { select: { id: true, code: true, type: true } } },
    });
    // Phase 28: audit (fire-and-forget)
    const { writeAudit } = require('../middleware/audit');
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'portal.booking.reschedule',
      entity: 'Booking', entityId: booking.id, newValue: { startAt, endAt },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ booking: updated });
  } catch (err) {
    return next(err);
  }
});

// GET /api/portal/documents — documents shared with me
router.get('/documents', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    const documents = await prisma.document.findMany({
      where: { memberId: member.id, ...tf },
      select: {
        id: true,
        title: true,
        category: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        notes: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ documents });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
