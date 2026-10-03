// Phase 42 Track 1: Employee Directory.
// Staff CRUD + department/status filters + profile. Mount: /api/employees (coordinator).
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

function employeesEnabled() {
  return !!(prisma && prisma.employee);
}
function guard503(req, res, next) {
  if (!employeesEnabled()) return res.status(503).json({ error: 'Employee schema pending migration' });
  next();
}
router.use(guard503);

const DEPARTMENTS = ['ops', 'finance', 'sales', 'admin', 'support'];
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract'];
const STATUSES = ['active', 'on_leave', 'exited'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'Employee', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const employeeSchema = z.object({
  userId: z.string().cuid().optional().nullable(),
  name: z.string().min(1).max(160),
  email: z.string().email().max(160).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  department: z.enum(DEPARTMENTS).default('ops'),
  designation: z.string().max(120).default('Staff'),
  joiningDate: z.coerce.date().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('full_time'),
  status: z.enum(STATUSES).default('active'),
  emergencyContact: z.string().max(40).optional().nullable(),
  cnic: z.string().max(60).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
});
const patchSchema = employeeSchema.partial().omit({ status: true, userId: true });

// GET / — employee directory (search + department + status filters)
router.get('/', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { search, department, status } = req.query;
    const where = { ...tf };
    if (department && DEPARTMENTS.includes(department)) where.department = department;
    if (status && STATUSES.includes(status)) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
        { designation: { contains: String(search), mode: 'insensitive' } },
      ];
    }
    const [items, total, byDept, active] = await Promise.all([
      prisma.employee.findMany({ where, orderBy: { name: 'asc' }, take: 200 }),
      prisma.employee.count({ where: { ...tf } }),
      prisma.employee.groupBy({ by: ['department'], where: { ...tf }, _count: true }),
      prisma.employee.count({ where: { ...tf, status: 'active' } }),
    ]);
    res.json({ items, total, active, byDept });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /:id — profile
router.get('/:id', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const emp = await prisma.employee.findFirst({ where: { id: req.params.id, ...tf }, include: { user: { select: { id: true, email: true, role: true } } } }).catch(() => prisma.employee.findFirst({ where: { id: req.params.id, ...tf } }));
    if (!emp) return res.status(404).json({ error: 'Not found' });
    res.json(emp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — add employee
router.post('/', hrOnly, validateBody(employeeSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (req.body.userId) {
      const u = await prisma.user.findFirst({ where: { id: req.body.userId, tenantId: tf.tenantId } });
      if (!u) return res.status(400).json({ error: 'Linked user not in this tenant' });
      const dup = await prisma.employee.findUnique({ where: { userId: req.body.userId } }).catch(() => null);
      if (dup) return res.status(409).json({ error: 'User already linked to an employee' });
    }
    const emp = await prisma.employee.create({ data: { ...req.body, tenantId: tf.tenantId } });
    audit(req, tf, 'employee.create', emp.id, { name: emp.name });
    // Phase 42: onboarding auto-start (fire-and-forget, direct logic — auth wali internal call se behtar)
    setImmediate(() => {
      (async () => {
        try {
          if (!prisma.employeeOnboarding || !prisma.onboardingTemplate) return;
          const existing = await prisma.employeeOnboarding.findFirst({ where: { employeeId: emp.id, tenantId: tf.tenantId, status: 'in_progress' } });
          if (existing) return;
          const template = await prisma.onboardingTemplate.findFirst({ where: { tenantId: tf.tenantId, isDefault: true } });
          if (!template || !Array.isArray(template.tasks) || !template.tasks.length) return;
          const items = template.tasks.map((t) => ({ title: t.title, dept: t.dept || 'admin', dayOffset: t.dayOffset || 0, done: false, doneBy: null, doneAt: null }));
          await prisma.employeeOnboarding.create({ data: { tenantId: tf.tenantId, employeeId: emp.id, templateId: template.id, items, status: 'in_progress' } });
        } catch {}
      })();
    });
    res.status(201).json(emp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /:id — edit profile (not status/userId)
router.patch('/:id', hrOnly, validateBody(patchSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const emp = await prisma.employee.findFirst({ where: { id: req.params.id, ...tf } });
    if (!emp) return res.status(404).json({ error: 'Not found' });
    const updated = await prisma.employee.update({ where: { id: emp.id }, data: req.body });
    audit(req, tf, 'employee.update', emp.id, req.body);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /:id/status — change employment status
router.patch('/:id/status', hrOnly, validateBody(z.object({ status: z.enum(STATUSES) })), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const emp = await prisma.employee.findFirst({ where: { id: req.params.id, ...tf } });
    if (!emp) return res.status(404).json({ error: 'Not found' });
    const updated = await prisma.employee.update({ where: { id: emp.id }, data: { status: req.body.status } });
    audit(req, tf, 'employee.status', emp.id, { from: emp.status, to: req.body.status });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
