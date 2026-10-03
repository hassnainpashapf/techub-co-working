// Phase 42 Track 8: Exit / Offboarding Process.
// Mount: /api/exits (coordinator). Clearance checklist + settlement summary.
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

const HR_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const hrOnly = requireRole(...HR_ROLES);

function exitsEnabled() {
  return !!(prisma && prisma.employeeExit);
}
function guard503(req, res, next) {
  if (!exitsEnabled()) return res.status(503).json({ error: 'Exit schema pending migration' });
  next();
}
router.use(guard503);

const EXIT_TYPES = ['resignation', 'termination'];
const EXIT_STATUSES = ['initiated', 'clearance_pending', 'completed'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'EmployeeExit', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// Default clearance checklist (dept-wise).
function defaultClearance() {
  return [
    { title: 'Laptop / devices return', dept: 'IT', done: false, doneBy: null, doneAt: null },
    { title: 'Accounts / email deprovision', dept: 'IT', done: false, doneBy: null, doneAt: null },
    { title: 'Dues settled', dept: 'Finance', done: false, doneBy: null, doneAt: null },
    { title: 'Salary advance / loan cleared', dept: 'Finance', done: false, doneBy: null, doneAt: null },
    { title: 'ID card returned', dept: 'Admin', done: false, doneBy: null, doneAt: null },
    { title: 'Access revoked', dept: 'Admin', done: false, doneBy: null, doneAt: null },
  ];
}

// Final settlement: pending advances/loans (Track 6 model — guarded if not merged yet).
async function settlementSummary(tenantId, employeeId) {
  const out = { advances: [], totalPending: 0 };
  if (!prisma.salaryAdvance) return out;
  const rows = await prisma.salaryAdvance.findMany({
    where: { tenantId, employeeId, status: { in: ['approved', 'deducting'] } },
  });
  for (const r of rows) {
    const deducted = r.totalDeducted ? Number(r.totalDeducted) : 0;
    const pending = Number(r.amount) - deducted;
    if (pending > 0) out.advances.push({ id: r.id, type: r.type, amount: Number(r.amount), pending });
    out.totalPending += pending;
  }
  return out;
}

// GET / — exit pipeline (status + search)
router.get('/', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { status, search } = req.query;
    const where = { ...tf };
    if (status && EXIT_STATUSES.includes(status)) where.status = status;
    if (search) {
      where.employee = {
        OR: [
          { name: { contains: String(search), mode: 'insensitive' } },
          { designation: { contains: String(search), mode: 'insensitive' } },
        ],
      };
    }
    const items = await prisma.employeeExit.findMany({
      where,
      include: { employee: { select: { id: true, name: true, designation: true, department: true } } },
      orderBy: { initiatedAt: 'desc' },
      take: 200,
    });
    res.json({ items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /:id — exit detail + clearance progress + settlement
router.get('/:id', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const exit = await prisma.employeeExit.findFirst({
      where: { ...tf, id: req.params.id },
      include: { employee: true },
    });
    if (!exit) return res.status(404).json({ error: 'Not found' });
    const items = Array.isArray(exit.clearanceItems) ? exit.clearanceItems : [];
    const done = items.filter((i) => i.done).length;
    const settlement = await settlementSummary(tf.tenantId, exit.employeeId);
    res.json({ exit, clearanceProgress: { done, total: items.length }, settlement });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const initiateSchema = z.object({
  employeeId: z.string().cuid(),
  type: z.enum(EXIT_TYPES),
  lastWorkingDay: z.coerce.date(),
  reason: z.string().max(500).optional().nullable(),
  noticeDays: z.number().int().min(0).max(365).optional().nullable(),
});

// POST /initiate — start exit + generate clearance checklist
router.post('/initiate', hrOnly, validateBody(initiateSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const emp = await prisma.employee.findFirst({
      where: { ...tf, id: req.body.employeeId },
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const dup = await prisma.employeeExit.findFirst({
      where: { ...tf, employeeId: emp.id, status: { in: ['initiated', 'clearance_pending'] } },
    });
    if (dup) return res.status(409).json({ error: 'Exit already in progress for this employee' });

    const exit = await prisma.employeeExit.create({
      data: {
        tenantId: tf.tenantId,
        employeeId: emp.id,
        type: req.body.type,
        lastWorkingDay: req.body.lastWorkingDay,
        reason: req.body.reason || null,
        noticeDays: req.body.noticeDays ?? null,
        clearanceItems: defaultClearance(),
        status: 'initiated',
        initiatedBy: req.user.sub,
      },
      include: { employee: { select: { id: true, name: true, designation: true } } },
    });
    audit(req, tf, 'exit.initiated', exit.id, { employeeId: emp.id, type: exit.type });
    res.status(201).json({ exit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const clearSchema = z.object({ index: z.number().int().min(0), note: z.string().max(200).optional().nullable() });

// POST /:id/clear — mark a clearance item done (dept clearance)
router.post('/:id/clear', hrOnly, validateBody(clearSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const exit = await prisma.employeeExit.findFirst({ where: { ...tf, id: req.params.id } });
    if (!exit) return res.status(404).json({ error: 'Not found' });
    if (exit.status === 'completed') return res.status(409).json({ error: 'Exit already completed' });

    const items = Array.isArray(exit.clearanceItems) ? exit.clearanceItems : [];
    const idx = req.body.index;
    if (idx >= items.length) return res.status(400).json({ error: 'Invalid clearance index' });
    items[idx] = {
      ...items[idx],
      done: true,
      doneBy: req.user.sub,
      doneAt: new Date().toISOString(),
      ...(req.body.note ? { note: req.body.note } : {}),
    };
    const allDone = items.length > 0 && items.every((i) => i.done);
    const updated = await prisma.employeeExit.update({
      where: { id: exit.id },
      data: {
        clearanceItems: items,
        status: allDone ? 'completed' : 'clearance_pending',
        completedAt: allDone ? new Date() : exit.completedAt,
      },
    });
    audit(req, tf, 'exit.clearance', exit.id, { index: idx, allDone });
    // If everything just cleared, complete the exit as well.
    if (allDone && exit.status !== 'completed') {
      await finalizeExit(tf, exit, req.user.sub);
      return res.json({ exit: await prisma.employeeExit.findUnique({ where: { id: exit.id } }), autoCompleted: true });
    }
    res.json({ exit: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function finalizeExit(tf, exit, actorId) {
  // Employee -> exited, linked login deactivated.
  try {
    const emp = await prisma.employee.update({
      where: { id: exit.employeeId },
      data: { status: 'exited' },
    });
    if (emp.userId) {
      await prisma.user.update({
        where: { id: emp.userId },
        data: { isActive: false },
      }).catch(() => {});
    }
  } catch (e) { /* employee merge pending — exit completion still recorded */ }
  writeAudit({
    tenantId: tf.tenantId, actorId, action: 'exit.completed',
    entity: 'EmployeeExit', entityId: exit.id, newValue: { status: 'completed' },
  }).catch(() => {});
}

// POST /:id/complete — finish exit manually (requires all clearance done)
router.post('/:id/complete', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const exit = await prisma.employeeExit.findFirst({ where: { ...tf, id: req.params.id } });
    if (!exit) return res.status(404).json({ error: 'Not found' });
    if (exit.status === 'completed') return res.status(409).json({ error: 'Exit already completed' });
    const items = Array.isArray(exit.clearanceItems) ? exit.clearanceItems : [];
    const pending = items.filter((i) => !i.done);
    if (pending.length > 0) {
      return res.status(422).json({ error: 'Clearance pending', pending: pending.map((p) => p.title) });
    }
    await prisma.employeeExit.update({
      where: { id: exit.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    await finalizeExit(tf, exit, req.user.sub);
    const updated = await prisma.employeeExit.findUnique({ where: { id: exit.id } });
    res.json({ exit: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
