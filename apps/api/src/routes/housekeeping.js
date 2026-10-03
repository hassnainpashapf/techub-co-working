// Phase 34 Track 10: Housekeeping / Cleaning Schedule.
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

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'operations_manager'];
const staffOnly = requireRole(...STAFF);
// office_boy can view + complete tasks; only staff can create/generate.
const WORKER_ROLES = [...STAFF, 'office_boy'];
const workerOnly = requireRole(...WORKER_ROLES);

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'one-time'];
const STATUSES = ['pending', 'done', 'skipped'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'CleaningTask', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const includeTask = {
  unit: { select: { id: true, code: true } },
  assignedTo: { select: { id: true, name: true } },
};

function dayRange(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  return { start, end };
}

// GET /api/housekeeping — list (?status=, ?due=today, ?assigned=mine)
router.get('/', workerOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { status, due, assigned } = req.query;
    const where = { ...tf };
    if (status && STATUSES.includes(status)) where.status = status;
    if (due === 'today') {
      const { start, end } = dayRange();
      where.dueDate = { gte: start, lte: end };
    }
    if (assigned === 'mine') where.assignedToId = req.user.sub;
    const tasks = await prisma.cleaningTask.findMany({
      where, include: includeTask, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 200,
    });
    return res.json({ tasks });
  } catch (err) { return next(err); }
});

const createSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional().nullable(),
  area: z.string().max(200).optional().nullable(),
  unitId: z.string().optional().nullable(),
  frequency: z.enum(FREQUENCIES).optional().default('one-time'),
  assignedToId: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
});

// POST /api/housekeeping — create task (staff)
router.post('/', staffOnly, validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const task = await prisma.cleaningTask.create({
      data: { ...tf, ...req.body }, include: includeTask,
    });
    audit(req, tf, 'housekeeping.task_created', task.id, { title: task.title });
    return res.status(201).json({ task });
  } catch (err) { return next(err); }
});

const completeSchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
});

// POST /api/housekeeping/:id/complete — mark done (office_boy + staff)
router.post('/:id/complete', workerOnly, validateBody(completeSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const task = await prisma.cleaningTask.updateMany({
      where: { id: req.params.id, ...tf, status: 'pending' },
      data: {
        status: 'done', completedAt: new Date(), completedById: req.user.sub,
        notes: req.body.notes ?? undefined,
      },
    });
    if (!task.count) return res.status(404).json({ error: { message: 'Task not found or already completed.' } });
    audit(req, tf, 'housekeeping.task_completed', req.params.id, { notes: req.body.notes });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// POST /api/housekeeping/:id/skip — skip (staff)
router.post('/:id/skip', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const task = await prisma.cleaningTask.updateMany({
      where: { id: req.params.id, ...tf, status: 'pending' },
      data: { status: 'skipped' },
    });
    if (!task.count) return res.status(404).json({ error: { message: 'Task not found or not pending.' } });
    audit(req, tf, 'housekeeping.task_skipped', req.params.id, {});
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

function nextDue(frequency, from) {
  const d = new Date(from);
  if (frequency === 'daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  return d;
}

// POST /api/housekeeping/generate — create today's instances from recurring templates (staff)
router.post('/generate', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { start, end } = dayRange();
    // Recurring templates = recurring tasks that were completed (or are the originals).
    const templates = await prisma.cleaningTask.findMany({
      where: { ...tf, frequency: { in: ['daily', 'weekly', 'monthly'] }, status: { in: ['done', 'skipped'] } },
      orderBy: { completedAt: 'desc' },
    });
    let created = 0;
    for (const t of templates) {
      const base = t.completedAt || t.dueDate || t.createdAt;
      const due = nextDue(t.frequency, base);
      // Only generate if the next due falls today and no pending task exists for this template today.
      if (due < start || due > end) continue;
      const exists = await prisma.cleaningTask.findFirst({
        where: {
          ...tf, status: 'pending', frequency: t.frequency, title: t.title, area: t.area, unitId: t.unitId,
          dueDate: { gte: start, lte: end },
        },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.cleaningTask.create({
        data: {
          tenantId: tf.tenantId, title: t.title, description: t.description, area: t.area,
          unitId: t.unitId, frequency: t.frequency, assignedToId: t.assignedToId, dueDate: due,
        },
      });
      created += 1;
    }
    audit(req, tf, 'housekeeping.tasks_generated', null, { created });
    return res.json({ created });
  } catch (err) { return next(err); }
});

module.exports = router;
