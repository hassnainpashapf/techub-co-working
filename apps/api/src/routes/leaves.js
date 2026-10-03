// Phase 42 Track 3: Leave Management — balances + approvals on existing Leave model.
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

const MANAGERS = ['ceo', 'admin', 'super_admin', 'manager'];
const LEAVE_TYPES = ['annual', 'sick', 'casual', 'unpaid'];
// Default yearly allocation when a balance row is auto-created.
const DEFAULT_ALLOCATION = { annual: 18, sick: 12, casual: 12 };

const leaveEnabled = () => Boolean(prisma.leave);
const balanceEnabled = () => Boolean(prisma.leaveBalance && prisma.employee);

// Inclusive day count between two dates (date-only safe).
function daysBetween(from, to) {
  const f = new Date(from); f.setHours(0, 0, 0, 0);
  const t = new Date(to); t.setHours(0, 0, 0, 0);
  return Math.round((t - f) / 86400000) + 1;
}
function eachDate(from, to) {
  const out = [];
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  const t = new Date(to); t.setHours(0, 0, 0, 0);
  while (d <= t) { out.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return out;
}

const requestSchema = z
  .object({
    type: z.enum(LEAVE_TYPES).default('annual'),
    fromDate: z.coerce.date(),
    toDate: z.coerce.date(),
    reason: z.string().optional().nullable(),
  })
  .refine((d) => d.fromDate <= d.toDate, { message: 'fromDate must be on or before toDate' });

async function linkedEmployee(req) {
  if (!prisma.employee) return null;
  return prisma.employee.findFirst({ where: { tenantId: req.user.tenantId, userId: req.user.sub } });
}

async function getOrCreateBalance(tenantId, employeeId, year, type) {
  if (type === 'unpaid') return null;
  let row = await prisma.leaveBalance.findUnique({
    where: { tenantId_employeeId_year_type: { tenantId, employeeId, year, type } },
  });
  if (!row) {
    row = await prisma.leaveBalance.create({
      data: { tenantId, employeeId, year, type, allocated: DEFAULT_ALLOCATION[type] ?? 0, used: 0 },
    });
  }
  return row;
}

// -------------------------------------------------------- employee routes ---
// POST /request — nayi leave request (balance check ke sath).
router.post('/request', validateBody(requestSchema), async (req, res, next) => {
  try {
    if (!leaveEnabled()) return res.status(503).json({ error: { message: 'Leave module not ready' } });
    const tf = tenantFilter(req);
    const { type, fromDate, toDate, reason } = req.body;
    const days = daysBetween(fromDate, toDate);

    let employee = null;
    if (balanceEnabled()) {
      employee = await linkedEmployee(req);
      if (employee) {
        const bal = await getOrCreateBalance(tf.tenantId, employee.id, fromDate.getFullYear(), type);
        if (bal && bal.used + days > bal.allocated) {
          return res.status(422).json({
            error: { message: `Insufficient ${type} leave balance`, remaining: bal.allocated - bal.used, needed: days },
          });
        }
      }
    }

    const leave = await prisma.leave.create({
      data: { ...tf, userId: req.user.sub, type, days, fromDate, toDate, reason: reason || null },
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'leave.request', entity: 'Leave', entityId: leave.id });
    return res.status(201).json({ leave });
  } catch (err) {
    return next(err);
  }
});

// GET /mine — meri requests + meri balances (iss saal).
router.get('/mine', async (req, res, next) => {
  try {
    if (!leaveEnabled()) return res.status(503).json({ error: { message: 'Leave module not ready' } });
    const tf = tenantFilter(req);
    const leaves = await prisma.leave.findMany({
      where: { ...tf, userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
    });
    let balances = [];
    if (balanceEnabled()) {
      const employee = await linkedEmployee(req);
      if (employee) {
        balances = await prisma.leaveBalance.findMany({
          where: { tenantId: tf.tenantId, employeeId: employee.id, year: new Date().getFullYear() },
        });
      }
    }
    return res.json({ leaves, balances });
  } catch (err) {
    return next(err);
  }
});

// -------------------------------------------------------- manager routes ----
// GET /pending — team ki pending requests.
router.get('/pending', requireRole(...MANAGERS), async (req, res, next) => {
  try {
    if (!leaveEnabled()) return res.status(503).json({ error: { message: 'Leave module not ready' } });
    const leaves = await prisma.leave.findMany({
      where: { ...tenantFilter(req), status: 'pending' },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ leaves });
  } catch (err) {
    return next(err);
  }
});

// POST /:id/approve — approve + balance.used update + attendance me on-leave mark.
router.post('/:id/approve', requireRole(...MANAGERS), async (req, res, next) => {
  try {
    if (!leaveEnabled()) return res.status(503).json({ error: { message: 'Leave module not ready' } });
    const tf = tenantFilter(req);
    const existing = await prisma.leave.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: { message: 'Leave not found' } });
    if (existing.status !== 'pending') {
      return res.status(400).json({ error: { message: 'Leave is already decided' } });
    }

    let leave = existing;
    await prisma.$transaction(async (tx) => {
      leave = await tx.leave.update({
        where: { id: existing.id },
        data: { status: 'approved', decidedById: req.user.sub },
      });
      // Balance update (linked employee ho to, unpaid skip).
      if (tx.leaveBalance && tx.employee && existing.type !== 'unpaid') {
        const employee = await tx.employee.findFirst({
          where: { tenantId: tf.tenantId, userId: existing.userId },
        });
        if (employee) {
          const year = new Date(existing.fromDate).getFullYear();
          await tx.leaveBalance.upsert({
            where: { tenantId_employeeId_year_type: { tenantId: tf.tenantId, employeeId: employee.id, year, type: existing.type } },
            create: { tenantId: tf.tenantId, employeeId: employee.id, year, type: existing.type, allocated: DEFAULT_ALLOCATION[existing.type] ?? 0, used: existing.days },
            update: { used: { increment: existing.days } },
          });
        }
      }
      // Attendance me on-leave mark (har din note ke sath).
      if (tx.attendanceRecord) {
        for (const d of eachDate(existing.fromDate, existing.toDate)) {
          await tx.attendanceRecord.upsert({
            where: { tenantId_userId_date: { tenantId: tf.tenantId, userId: existing.userId, date: d } },
            create: { tenantId: tf.tenantId, userId: existing.userId, date: d, note: 'On leave' },
            update: { note: 'On leave' },
          });
        }
      }
    });

    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'leave.approve', entity: 'Leave', entityId: leave.id });
    return res.json({ leave });
  } catch (err) {
    return next(err);
  }
});

const rejectSchema = z.object({ reason: z.string().optional().nullable() });

// POST /:id/reject — reject (reason optional).
router.post('/:id/reject', requireRole(...MANAGERS), validateBody(rejectSchema), async (req, res, next) => {
  try {
    if (!leaveEnabled()) return res.status(503).json({ error: { message: 'Leave module not ready' } });
    const tf = tenantFilter(req);
    const existing = await prisma.leave.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: { message: 'Leave not found' } });
    if (existing.status !== 'pending') {
      return res.status(400).json({ error: { message: 'Leave is already decided' } });
    }
    const leave = await prisma.leave.update({
      where: { id: existing.id },
      data: { status: 'rejected', decidedById: req.user.sub },
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'leave.reject', entity: 'Leave', entityId: leave.id, newValue: req.body.reason || null });
    return res.json({ leave });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
