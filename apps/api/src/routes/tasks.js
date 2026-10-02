const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { createNotification } = require('../lib/notify');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const PRIVILEGED = ['ceo', 'admin', 'operations_manager', 'manager'];
const isPrivileged = (role) => PRIVILEGED.includes(role);

const STATUSES = ['pending', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const NEXT_STATUS = { pending: ['in_progress', 'done'], in_progress: ['done'], done: [] };

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  priority: z.enum(PRIORITIES).default('medium'),
  dueDate: z.coerce.date().optional().nullable(),
});

const updateTaskSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    assigneeId: z.string().optional().nullable(),
    priority: z.enum(PRIORITIES).optional(),
    dueDate: z.coerce.date().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

const statusSchema = z.object({ status: z.enum(STATUSES) });

const includeTask = {
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

function taskScope(req) {
  const where = { ...tenantFilter(req) };
  // office_boy only ever sees their own work (unless ?mine=1 is requested by
  // a privileged role — the filter just enforces the scoping default).
  if (req.query.mine === '1' || req.user.role === 'office_boy') {
    where.assigneeId = req.user.sub;
  } else {
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.assigneeId) where.assigneeId = String(req.query.assigneeId);
  }
  return where;
}

router.get('/', async (req, res, next) => {
  try {
    const tasks = await prisma.task.findMany({
      where: taskScope(req),
      include: includeTask,
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ tasks });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(createTaskSchema), async (req, res, next) => {
  try {
    const { assigneeId, ...rest } = req.body;

    if (assigneeId) {
      const assignee = await prisma.user.findFirst({
        where: { id: assigneeId, tenantId: req.user.tenantId },
      });
      if (!assignee) {
        return res.status(400).json({ error: { message: 'Assignee not found in this tenant' } });
      }
    }

    const task = await prisma.task.create({
      data: {
        ...tenantFilter(req),
        ...rest,
        assigneeId: assigneeId || null,
        createdById: req.user.sub,
      },
      include: includeTask,
    });

    if (assigneeId) {
      await createNotification(prisma, {
        tenantId: req.user.tenantId,
        userId: assigneeId,
        type: 'task_assigned',
        message: `Task assigned: ${task.title}`,
      });
    }

    return res.status(201).json({ task });
  } catch (err) {
    return next(err);
  }
});

// Edit: privileged roles or the creator.
router.patch('/:id', validateBody(updateTaskSchema), async (req, res, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Task not found' } });
    if (!isPrivileged(req.user.role) && existing.createdById !== req.user.sub) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    if (req.body.assigneeId) {
      const assignee = await prisma.user.findFirst({
        where: { id: req.body.assigneeId, tenantId: req.user.tenantId },
      });
      if (!assignee) {
        return res.status(400).json({ error: { message: 'Assignee not found in this tenant' } });
      }
    }
    const task = await prisma.task.update({
      where: { id: existing.id },
      data: req.body,
      include: includeTask,
    });
    return res.json({ task });
  } catch (err) {
    return next(err);
  }
});

// Status change: the assignee, the creator, or a privileged role.
// Valid transitions: pending→in_progress→done, plus pending→done directly.
router.patch('/:id/status', validateBody(statusSchema), async (req, res, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Task not found' } });
    const me = req.user;
    const allowed =
      isPrivileged(me.role) ||
      existing.assigneeId === me.sub ||
      existing.createdById === me.sub;
    if (!allowed) return res.status(403).json({ error: { message: 'Forbidden' } });

    const from = existing.status;
    const to = req.body.status;
    if (from !== to && !NEXT_STATUS[from].includes(to)) {
      return res.status(400).json({
        error: { message: `Invalid status transition: ${from} → ${to}` },
      });
    }
    const task = await prisma.task.update({
      where: { id: existing.id },
      data: { status: to, completedAt: to === 'done' ? new Date() : existing.completedAt },
      include: includeTask,
    });
    return res.json({ task });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Task not found' } });
    if (!isPrivileged(req.user.role) && existing.createdById !== req.user.sub) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    await prisma.task.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
