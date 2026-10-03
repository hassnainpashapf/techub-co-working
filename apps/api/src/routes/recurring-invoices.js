// Phase 31: Recurring Invoices — membership/subscription style auto-billing.
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

const BILLING_ROLES = ['ceo', 'admin', 'super_admin', 'finance_officer'];
const billingWrite = requireRole(...BILLING_ROLES);

// --- helpers ---------------------------------------------------------------
function clampDay(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return 1;
  return Math.min(28, Math.max(1, Math.floor(n)));
}

// nextRunAt: first run on startDate (at dayOfMonth, or startDate itself if later),
// then advance by frequency. All at 00:00 local.
function firstRunAt(startDate, dayOfMonth) {
  const d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  const day = clampDay(dayOfMonth);
  // If startDate is already past `day` this month, first run = next month's `day`.
  if (d.getDate() > day) {
    return new Date(d.getFullYear(), d.getMonth() + 1, day);
  }
  return new Date(d.getFullYear(), d.getMonth(), day);
}

function advanceRunAt(runAt, frequency) {
  const d = new Date(runAt);
  const months = frequency === 'quarterly' ? 3 : frequency === 'yearly' ? 12 : 1;
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}

// --- schemas ---------------------------------------------------------------
const createSchema = z.object({
  memberId: z.string().min(1),
  title: z.string().min(1).max(200),
  amount: z.number().positive().max(100000000),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']).default('monthly'),
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  amount: z.number().positive().max(100000000).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
});

// --- routes ----------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.memberId) where.memberId = String(req.query.memberId);
    const items = await prisma.recurringInvoice.findMany({
      where,
      include: { member: { select: { id: true, name: true, email: true } } },
      orderBy: { nextRunAt: 'asc' },
    });
    return res.json({ recurringInvoices: items });
  } catch (err) {
    return next(err);
  }
});

router.post('/', billingWrite, validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await prisma.member.findFirst({
      where: { id: req.body.memberId, ...tf },
    });
    if (!member) return res.status(404).json({ error: { message: 'Member not found' } });

    const startDate = new Date(req.body.startDate + 'T00:00:00');
    const endDate = req.body.endDate ? new Date(req.body.endDate + 'T00:00:00') : null;
    if (endDate && endDate < startDate) {
      return res.status(400).json({ error: { message: 'End date must be after start date' } });
    }

    const nextRunAt = firstRunAt(startDate, req.body.dayOfMonth);
    const item = await prisma.recurringInvoice.create({
      data: {
        tenantId: tf.tenantId,
        memberId: member.id,
        title: req.body.title,
        amount: req.body.amount,
        frequency: req.body.frequency,
        dayOfMonth: clampDay(req.body.dayOfMonth),
        startDate,
        endDate,
        status: 'active',
        nextRunAt,
      },
      include: { member: { select: { id: true, name: true, email: true } } },
    });

    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'recurring_invoice.created',
      entity: 'RecurringInvoice',
      entityId: item.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.status(201).json({ recurringInvoice: item });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', billingWrite, validateBody(patchSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.recurringInvoice.findFirst({
      where: { id: req.params.id, ...tf },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Not found' } });

    const data = {};
    if (req.body.title !== undefined) data.title = req.body.title;
    if (req.body.amount !== undefined) data.amount = req.body.amount;
    if (req.body.endDate !== undefined) {
      data.endDate = req.body.endDate ? new Date(req.body.endDate + 'T00:00:00') : null;
    }
    if (req.body.status !== undefined) data.status = req.body.status;
    if (req.body.frequency !== undefined || req.body.dayOfMonth !== undefined) {
      const freq = req.body.frequency || existing.frequency;
      const dom = req.body.dayOfMonth !== undefined ? clampDay(req.body.dayOfMonth) : existing.dayOfMonth;
      data.frequency = freq;
      data.dayOfMonth = dom;
      // Recompute nextRunAt from the (possibly new) schedule, anchored at last run or start.
      const anchor = existing.lastGeneratedAt || existing.startDate;
      let next = firstRunAt(anchor, dom);
      // Advance while next is in the past (schedule changed mid-cycle)
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      let guard = 0;
      while (next < now && guard++ < 60) next = advanceRunAt(next, freq);
      data.nextRunAt = next;
    }

    const updated = await prisma.recurringInvoice.update({
      where: { id: existing.id },
      data,
      include: { member: { select: { id: true, name: true, email: true } } },
    });

    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'recurring_invoice.updated',
      entity: 'RecurringInvoice',
      entityId: existing.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.json({ recurringInvoice: updated });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', billingWrite, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.recurringInvoice.findFirst({
      where: { id: req.params.id, ...tf },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Not found' } });
    // Soft-cancel: past generated invoices stay untouched.
    await prisma.recurringInvoice.update({
      where: { id: existing.id },
      data: { status: 'cancelled' },
    });

    writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'recurring_invoice.cancelled',
      entity: 'RecurringInvoice',
      entityId: existing.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.firstRunAt = firstRunAt;
module.exports.advanceRunAt = advanceRunAt;
module.exports.clampDay = clampDay;
