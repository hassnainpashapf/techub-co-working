// Phase 42 Track 7: Employee Onboarding Checklists.
// Mount: /api/employee-onboarding (coordinator). New file — server.js/Sidebar.js untouched.
// NOTE: /api/onboarding pehle se Phase 35 (tenant wizard) use karta hai, is liye alag path hai.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { createNotification } = require('../lib/notify');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const HR_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const hrOnly = requireRole(...HR_ROLES);

function onboardingEnabled() {
  return !!(prisma && prisma.onboardingTemplate && prisma.employeeOnboarding);
}
function guard503(req, res, next) {
  if (!onboardingEnabled()) return res.status(503).json({ error: 'Onboarding schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entity, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity, entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const taskSchema = z.object({
  title: z.string().min(1).max(200),
  dept: z.string().max(60).default('admin'),
  dayOffset: z.number().int().min(0).max(365).default(0),
});

const templateSchema = z.object({
  name: z.string().min(1).max(160),
  tasks: z.array(taskSchema).min(1).max(50),
  isDefault: z.boolean().default(false),
});
const templatePatchSchema = templateSchema.partial();

// ---------- templates ----------

// GET /api/employee-onboarding/templates
router.get('/templates', hrOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const templates = await prisma.onboardingTemplate.findMany({
    where: { tenantId: tf.tenantId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ templates });
});

// POST /api/employee-onboarding/templates
router.post('/templates', hrOnly, validateBody(templateSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const { name, tasks, isDefault } = req.body;
  const created = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.onboardingTemplate.updateMany({
        where: { tenantId: tf.tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.onboardingTemplate.create({
      data: { tenantId: tf.tenantId, name, tasks, isDefault: !!isDefault },
    });
  });
  audit(req, tf, 'onboarding_template.create', 'OnboardingTemplate', created.id, { name });
  res.status(201).json({ template: created });
});

// PATCH /api/employee-onboarding/templates/:id
router.patch('/templates/:id', hrOnly, validateBody(templatePatchSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const existing = await prisma.onboardingTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
  });
  if (!existing) return res.status(404).json({ error: 'Template nahi mila' });
  const updated = await prisma.$transaction(async (tx) => {
    if (req.body.isDefault === true) {
      await tx.onboardingTemplate.updateMany({
        where: { tenantId: tf.tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.onboardingTemplate.update({ where: { id: existing.id }, data: { ...req.body } });
  });
  audit(req, tf, 'onboarding_template.update', 'OnboardingTemplate', existing.id, req.body);
  res.json({ template: updated });
});

// DELETE /api/employee-onboarding/templates/:id
router.delete('/templates/:id', hrOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const existing = await prisma.onboardingTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
  });
  if (!existing) return res.status(404).json({ error: 'Template nahi mila' });
  await prisma.onboardingTemplate.delete({ where: { id: existing.id } });
  audit(req, tf, 'onboarding_template.delete', 'OnboardingTemplate', existing.id, null);
  res.json({ ok: true });
});

// ---------- onboardings ----------

// GET /api/employee-onboarding (list active onboardings with progress)
router.get('/', hrOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const { status = 'all' } = req.query;
  const where = { tenantId: tf.tenantId };
  if (status !== 'all') where.status = status;
  const rows = await prisma.employeeOnboarding.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: 200,
  });
  let empMap = {};
  if (prisma.employee) {
    const emps = await prisma.employee.findMany({
      where: { id: { in: rows.map((r) => r.employeeId) }, tenantId: tf.tenantId },
      select: { id: true, name: true, designation: true, department: true },
    });
    empMap = Object.fromEntries(emps.map((e) => [e.id, e]));
  }
  res.json({
    onboardings: rows.map((r) => {
      const items = Array.isArray(r.items) ? r.items : [];
      const done = items.filter((i) => i.done).length;
      return {
        ...r,
        employee: empMap[r.employeeId] || { name: '—' },
        progress: { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 },
      };
    }),
  });
});

// POST /api/employee-onboarding/start { employeeId, templateId? }
router.post('/start', hrOnly, validateBody(z.object({
  employeeId: z.string().cuid(),
  templateId: z.string().cuid().optional().nullable(),
})), async (req, res) => {
  const tf = tenantFilter(req);
  const { employeeId, templateId } = req.body;

  if (prisma.employee) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId: tf.tenantId } });
    if (!emp) return res.status(404).json({ error: 'Employee nahi mila' });
  }

  let template = null;
  if (templateId) {
    template = await prisma.onboardingTemplate.findFirst({ where: { id: templateId, tenantId: tf.tenantId } });
    if (!template) return res.status(404).json({ error: 'Template nahi mila' });
  } else {
    template = await prisma.onboardingTemplate.findFirst({ where: { tenantId: tf.tenantId, isDefault: true } });
  }
  const tasks = template && Array.isArray(template.tasks) ? template.tasks : [];
  if (!tasks.length) return res.status(400).json({ error: 'Template me koi task nahi hai' });

  const existing = await prisma.employeeOnboarding.findFirst({
    where: { employeeId, tenantId: tf.tenantId, status: 'in_progress' },
  });
  if (existing) return res.status(409).json({ error: 'Is employee ka onboarding pehle se chal raha hai', onboarding: existing });

  const items = tasks.map((t) => ({
    title: t.title, dept: t.dept || 'admin', dayOffset: t.dayOffset || 0,
    done: false, doneBy: null, doneAt: null,
  }));
  const created = await prisma.employeeOnboarding.create({
    data: {
      tenantId: tf.tenantId, employeeId,
      templateId: template ? template.id : null,
      items, status: 'in_progress',
    },
  });
  audit(req, tf, 'onboarding.start', 'EmployeeOnboarding', created.id, { employeeId });
  res.status(201).json({ onboarding: created });
});

// POST /api/employee-onboarding/:id/check { index }
router.post('/:id/check', hrOnly, validateBody(z.object({ index: z.number().int().min(0) })), async (req, res) => {
  const tf = tenantFilter(req);
  const ob = await prisma.employeeOnboarding.findFirst({ where: { id: req.params.id, tenantId: tf.tenantId } });
  if (!ob) return res.status(404).json({ error: 'Onboarding nahi mila' });
  const items = Array.isArray(ob.items) ? [...ob.items] : [];
  const { index } = req.body;
  if (index >= items.length) return res.status(400).json({ error: 'Ghalat item index' });
  if (items[index].done) return res.json({ onboarding: ob }); // idempotent

  items[index] = { ...items[index], done: true, doneBy: req.user.sub, doneAt: new Date().toISOString() };
  const allDone = items.every((i) => i.done);
  const updated = await prisma.employeeOnboarding.update({
    where: { id: ob.id },
    data: {
      items,
      status: allDone ? 'completed' : ob.status,
      completedAt: allDone ? new Date() : ob.completedAt,
    },
  });
  audit(req, tf, 'onboarding.check', 'EmployeeOnboarding', ob.id, { index, title: items[index].title });

  if (allDone) {
    try {
      await createNotification(prisma, {
        tenantId: tf.tenantId, role: 'manager',
        type: 'onboarding.completed',
        message: `Employee onboarding complete ho gaya (${items.length} tasks)`,
      });
    } catch {}
  }
  res.json({ onboarding: updated });
});

// POST /api/employee-onboarding/auto-start { employeeId }
// COORDINATOR INTEGRATION NOTE: employee create route (routes/employees.js POST /) me,
// employee banne ke baad fire-and-forget call karo:
//   fetch(`/api/employee-onboarding/auto-start`, { method: 'POST', headers, body: JSON.stringify({ employeeId }) })
router.post('/auto-start', hrOnly, validateBody(z.object({ employeeId: z.string().cuid() })), async (req, res) => {
  const tf = tenantFilter(req);
  try {
    const { employeeId } = req.body;
    const existing = await prisma.employeeOnboarding.findFirst({
      where: { employeeId, tenantId: tf.tenantId, status: 'in_progress' },
    });
    if (existing) return res.json({ started: false, reason: 'already_in_progress' });
    const template = await prisma.onboardingTemplate.findFirst({ where: { tenantId: tf.tenantId, isDefault: true } });
    if (!template || !Array.isArray(template.tasks) || !template.tasks.length) {
      return res.json({ started: false, reason: 'no_default_template' });
    }
    const items = template.tasks.map((t) => ({
      title: t.title, dept: t.dept || 'admin', dayOffset: t.dayOffset || 0,
      done: false, doneBy: null, doneAt: null,
    }));
    const created = await prisma.employeeOnboarding.create({
      data: { tenantId: tf.tenantId, employeeId, templateId: template.id, items, status: 'in_progress' },
    });
    audit(req, tf, 'onboarding.auto_start', 'EmployeeOnboarding', created.id, { employeeId });
    return res.status(201).json({ started: true, onboarding: created });
  } catch (e) {
    return res.json({ started: false, reason: 'error', error: e.message });
  }
});

module.exports = router;
