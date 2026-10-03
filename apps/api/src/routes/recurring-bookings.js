// Phase 29 Track 2: Recurring bookings — weekly repeat rules that
// generate real Booking rows (next 8 weeks), overlap-safe.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const auditAsync = (data) => writeAudit(data).catch(() => {});

const router = express.Router();

router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'operations_manager', 'manager', 'receptionist'];
const anyone = requireRole(...STAFF, 'member');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;

const recurringSchema = z
  .object({
    memberId: z.string().min(1).optional().nullable(),
    unitId: z.string().min(1),
    title: z.string().min(1),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(timeRe, 'startTime must be HH:mm'),
    endTime: z.string().regex(timeRe, 'endTime must be HH:mm'),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional().nullable(),
  })
  .refine((d) => d.startTime < d.endTime, { message: 'endTime must be after startTime' })
  .refine((d) => !d.endDate || d.endDate >= d.startDate, { message: 'endDate must be on/after startDate' });

const statusSchema = z.object({ status: z.enum(['active', 'paused']) });

// Overlap check — same logic as bookings.js findOverlap: another CONFIRMED
// booking on the same unit whose interval intersects [startAt, endAt).
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

function combineDateTime(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

// First date on/after `from` that falls on dayOfWeek.
function firstWeekdayOnOrAfter(from, dayOfWeek) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((dayOfWeek - d.getDay() + 7) % 7));
  return d;
}

const includeRule = {
  member: { select: { id: true, name: true, email: true } },
  unit: { select: { id: true, code: true, type: true } },
};

// Member role: only own records.
function scopeFor(req) {
  const where = { ...tenantFilter(req) };
  if (req.user.role === 'member') where.memberId = req.user.memberId || '__none__';
  return where;
}

// List
router.get('/', anyone, async (req, res, next) => {
  try {
    const where = scopeFor(req);
    if (req.query.memberId) where.memberId = String(req.query.memberId);
    if (req.query.status) where.status = String(req.query.status);
    // Members cannot widen the filter beyond themselves.
    if (req.user.role === 'member') where.memberId = req.user.memberId || '__none__';
    const items = await prisma.recurringBooking.findMany({
      where,
      include: includeRule,
      orderBy: { createdAt: 'desc' },
    });
    const withLabels = items.map((r) => ({ ...r, weekdayLabel: WEEKDAYS[r.dayOfWeek] }));
    return res.json({ recurringBookings: withLabels });
  } catch (err) {
    return next(err);
  }
});

// Create rule + generate next 8 weeks of bookings (overlap-free)
router.post('/', anyone, validateBody(recurringSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    let { memberId, unitId, title, dayOfWeek, startTime, endTime, startDate, endDate } = req.body;

    const unit = await prisma.unit.findFirst({ where: { id: unitId, ...tf } });
    if (!unit) return res.status(400).json({ error: { message: 'Unit not found' } });

    if (req.user.role === 'member') {
      memberId = req.user.memberId;
      if (!memberId) return res.status(403).json({ error: { message: 'Member record required' } });
    } else if (memberId) {
      const member = await prisma.member.findFirst({ where: { id: memberId, ...tf } });
      if (!member) return res.status(400).json({ error: { message: 'Member not found' } });
    }

    const rule = await prisma.recurringBooking.create({
      data: {
        ...tf,
        memberId: memberId || null,
        unitId,
        title,
        dayOfWeek,
        startTime,
        endTime,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        status: 'active',
        createdBy: req.user.sub,
      },
    });

    // Generate occurrences: next 8 weekly slots, capped by endDate.
    const now = new Date();
    const generatedIds = [];
    let skipped = 0;
    let cursor = firstWeekdayOnOrAfter(startDate, dayOfWeek);
    for (let i = 0; i < 8; i++) {
      const day = new Date(cursor);
      day.setDate(day.getDate() + i * 7);
      if (endDate && day > new Date(endDate)) break;
      const startAt = combineDateTime(day, startTime);
      const endAt = combineDateTime(day, endTime);
      if (startAt < now) {
        skipped += 1;
        continue;
      }
      const clash = await findOverlap(tf.tenantId, unitId, startAt, endAt);
      if (clash) {
        skipped += 1;
        continue;
      }
      const booking = await prisma.booking.create({
        data: {
          ...tf,
          unitId,
          memberId: memberId || null,
          title: `${title} (recurring)`,
          startAt,
          endAt,
          createdById: req.user.sub,
        },
      });
      generatedIds.push(booking.id);
    }

    const updated = await prisma.recurringBooking.update({
      where: { id: rule.id },
      data: { generatedIds },
      include: includeRule,
    });

    auditAsync({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'recurring.create',
      entity: 'RecurringBooking',
      entityId: rule.id,
      newValue: { title, generated: generatedIds.length, skipped },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json({
      recurringBooking: { ...updated, weekdayLabel: WEEKDAYS[updated.dayOfWeek] },
      generated: generatedIds.length,
      skipped,
    });
  } catch (err) {
    return next(err);
  }
});

// Pause / resume
router.patch('/:id', anyone, validateBody(statusSchema), async (req, res, next) => {
  try {
    const where = { id: req.params.id, ...scopeFor(req) };
    const existing = await prisma.recurringBooking.findFirst({ where });
    if (!existing) return res.status(404).json({ error: { message: 'Recurring booking not found' } });
    const updated = await prisma.recurringBooking.update({
      where: { id: existing.id },
      data: { status: req.body.status },
      include: includeRule,
    });
    auditAsync({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: `recurring.${req.body.status === 'paused' ? 'pause' : 'resume'}`,
      entity: 'RecurringBooking',
      entityId: existing.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ recurringBooking: { ...updated, weekdayLabel: WEEKDAYS[updated.dayOfWeek] } });
  } catch (err) {
    return next(err);
  }
});

// Cancel + delete future generated bookings (past ones stay)
router.delete('/:id', anyone, async (req, res, next) => {
  try {
    const where = { id: req.params.id, ...scopeFor(req) };
    const existing = await prisma.recurringBooking.findFirst({ where });
    if (!existing) return res.status(404).json({ error: { message: 'Recurring booking not found' } });
    const now = new Date();
    let deletedBookings = 0;
    if (existing.generatedIds && existing.generatedIds.length) {
      const r = await prisma.booking.deleteMany({
        where: {
          id: { in: existing.generatedIds },
          tenantId: req.user.tenantId,
          startAt: { gte: now },
        },
      });
      deletedBookings = r.count;
    }
    await prisma.recurringBooking.update({ where: { id: existing.id }, data: { status: 'cancelled' } });
    auditAsync({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'recurring.cancel',
      entity: 'RecurringBooking',
      entityId: existing.id,
      newValue: { deletedBookings },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ ok: true, deletedBookings });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
