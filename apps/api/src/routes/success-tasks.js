// Phase 54 Track 7: Success Manager Tasks API.
// Mount (coordinator): app.use('/api/success-tasks', require('./routes/success-tasks'));
//
// Staff endpoints (ceo/admin/super_admin/manager):
//   GET  /api/success-tasks?status=&assignedTo=&memberId= -> task list (member name join)
//   POST /api/success-tasks                              -> manual task banao
//   PATCH /api/success-tasks/:id                         -> update (title/dueAt/notes/assignedTo)
//   POST /api/success-tasks/:id/complete                 -> done mark
//   POST /api/success-tasks/:id/assign { userId }        -> assign/reassign
//   POST /api/success-tasks/generate                     -> auto-generation foran chalao (ceo/admin)
// NOTE: SuccessTask model Phase 54 Track 7 fragment se aata hai (merge se pehle 503).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { generateSuccessTasks } = require('../lib/successTaskGen');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const STATUS = ['open', 'done', 'overdue'];

// Merge se pehle graceful 503 (koi 500 nahi).
router.use((req, res, next) => {
  if (!prisma.successTask) return res.status(503).json({ error: 'success_tasks_not_ready' });
  next();
});

// Overdue refresh: open tasks jinki dueAt guzar gayi -> overdue.
async function refreshOverdue(tenantId) {
  await prisma.successTask.updateMany({
    where: { tenantId, status: 'open', dueAt: { lt: new Date() } },
    data: { status: 'overdue' },
  });
}

// GET / — list with filters.
router.get('/', requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const { status, assignedTo, memberId, limit = '50' } = req.query;
    await refreshOverdue(req.user.tenantId);
    const where = { ...tenantFilter(req) };
    if (status && STATUS.includes(status)) where.status = status;
    if (assignedTo) where.assignedTo = assignedTo;
    if (memberId) where.memberId = memberId;
    const tasks = await prisma.successTask.findMany({
      where,
      include: {
        member: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: Math.min(parseInt(limit, 10) || 50, 200),
    });
    const counts = await prisma.successTask.groupBy({
      by: ['status'],
      where: tenantFilter(req),
      _count: { id: true },
    });
    res.json({
      tasks,
      counts: counts.reduce((a, c) => ({ ...a, [c.status]: c._count.id }), {}),
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// POST / — manual task.
const createSchema = z.object({
  memberId: z.string().min(1),
  title: z.string().min(3).max(200),
  dueAt: z.string().datetime({ offset: true }).or(z.string()),
  notes: z.string().max(2000).optional(),
  assignedTo: z.string().optional(),
});
router.post('/', requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const input = createSchema.parse(req.body);
    const member = await prisma.member.findFirst({
      where: { ...tenantFilter(req), id: input.memberId },
      select: { id: true },
    });
    if (!member) return res.status(404).json({ error: 'member_not_found' });
    if (input.assignedTo) {
      const u = await prisma.user.findFirst({
        where: { ...tenantFilter(req), id: input.assignedTo },
        select: { id: true },
      });
      if (!u) return res.status(404).json({ error: 'user_not_found' });
    }
    const task = await prisma.successTask.create({
      data: {
        ...tenantFilter(req),
        memberId: input.memberId,
        title: input.title,
        dueAt: new Date(input.dueAt),
        notes: input.notes || null,
        assignedTo: input.assignedTo || null,
        source: 'manual',
        createdBy: req.user.id,
      },
    });
    await writeAudit(prisma, {
      tenantId: req.user.tenantId, actorId: req.user.id,
      action: 'success_task.created', entity: 'SuccessTask', entityId: task.id,
    });
    res.status(201).json({ task });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(422).json({ error: 'validation', details: e.errors });
    res.status(500).json({ error: 'server_error' });
  }
});

// PATCH /:id — update.
const updateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  dueAt: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['open', 'done', 'overdue']).optional(),
});
router.patch('/:id', requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const input = updateSchema.parse(req.body);
    const existing = await prisma.successTask.findFirst({
      where: { ...tenantFilter(req), id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'task_not_found' });
    const data = { ...input };
    if (input.dueAt) data.dueAt = new Date(input.dueAt);
    if (input.status === 'done') data.completedAt = new Date();
    if (input.status && input.status !== 'done') data.completedAt = null;
    const task = await prisma.successTask.update({ where: { id: existing.id }, data });
    await writeAudit(prisma, {
      tenantId: req.user.tenantId, actorId: req.user.id,
      action: 'success_task.updated', entity: 'SuccessTask', entityId: task.id,
    });
    res.json({ task });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(422).json({ error: 'validation', details: e.errors });
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /:id/complete — done mark.
router.post('/:id/complete', requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const existing = await prisma.successTask.findFirst({
      where: { ...tenantFilter(req), id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'task_not_found' });
    const task = await prisma.successTask.update({
      where: { id: existing.id },
      data: { status: 'done', completedAt: new Date() },
    });
    await writeAudit(prisma, {
      tenantId: req.user.tenantId, actorId: req.user.id,
      action: 'success_task.completed', entity: 'SuccessTask', entityId: task.id,
    });
    res.json({ task });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /:id/assign — assign/reassign.
router.post('/:id/assign', requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const { userId } = z.object({ userId: z.string().min(1).nullable() }).parse(req.body);
    const existing = await prisma.successTask.findFirst({
      where: { ...tenantFilter(req), id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'task_not_found' });
    if (userId) {
      const u = await prisma.user.findFirst({
        where: { ...tenantFilter(req), id: userId }, select: { id: true },
      });
      if (!u) return res.status(404).json({ error: 'user_not_found' });
    }
    const task = await prisma.successTask.update({
      where: { id: existing.id },
      data: { assignedTo: userId },
    });
    await writeAudit(prisma, {
      tenantId: req.user.tenantId, actorId: req.user.id,
      action: 'success_task.assigned', entity: 'SuccessTask', entityId: task.id,
      meta: { assignedTo: userId },
    });
    res.json({ task });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(422).json({ error: 'validation', details: e.errors });
    res.status(500).json({ error: 'server_error' });
  }
});

// DELETE /:id
router.delete('/:id', requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const existing = await prisma.successTask.findFirst({
      where: { ...tenantFilter(req), id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'task_not_found' });
    await prisma.successTask.delete({ where: { id: existing.id } });
    await writeAudit(prisma, {
      tenantId: req.user.tenantId, actorId: req.user.id,
      action: 'success_task.deleted', entity: 'SuccessTask', entityId: req.params.id,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /generate — auto-generation foran (ceo/admin).
router.post('/generate', requireRole('ceo', 'admin', 'super_admin'), async (req, res) => {
  try {
    const result = await generateSuccessTasks();
    await writeAudit(prisma, {
      tenantId: req.user.tenantId, actorId: req.user.id,
      action: 'success_task.generated', entity: 'SuccessTask', entityId: null, meta: result,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
