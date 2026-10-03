// Phase 43 Track 8: Kitchen Staff & Shifts for Cafe.
// Cafe staff role assignment (chef/cashier/runner) — linked to Employee.
// Mount: /api/cafe-staff (coordinator).
//
// Exports (dusri routes ke liye — kitchen display guard):
//   const { requireCafeAccess, getCafeRole } = require('./cafe-staff');
//   router.get('/queue', authenticate, requireTenantUser, requireCafeAccess, handler)
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

function cafeStaffEnabled() {
  return !!(prisma && prisma.cafeStaff && prisma.employee);
}
function guard503(req, res, next) {
  if (!cafeStaffEnabled()) return res.status(503).json({ error: 'Cafe staff schema pending migration' });
  next();
}
router.use(guard503);

const CAFE_ROLES = ['chef', 'cashier', 'runner'];
const CAFE_ROLE_LABELS = { chef: 'Chef', cashier: 'Cashier', runner: 'Runner' };

// ---- Shared helper: logged-in user ka active cafe role ----
// Returns { id, role, employee } ya null. Kitchen display / food-orders
// routes isay guard ke liye use kar sakti hain.
async function getCafeRole(tenantId, userId) {
  if (!cafeStaffEnabled()) return null;
  try {
    const employee = await prisma.employee.findFirst({
      where: { ...tenantFilter({ user: { tenantId, sub: userId } }), userId },
      select: { id: true, name: true, status: true },
    });
    if (!employee || employee.status !== 'active') return null;
    const staff = await prisma.cafeStaff.findFirst({
      where: { tenantId, employeeId: employee.id, isActive: true },
      include: { employee: { select: { id: true, name: true, designation: true } } },
    });
    return staff;
  } catch {
    return null;
  }
}

// Kitchen display access guard: cafe staff (chef/cashier/runner) ya admin roles.
// Usage: router.get('/kitchen/queue', authenticate, requireTenantUser, requireCafeAccess, ...)
async function requireCafeAccess(req, res, next) {
  try {
    const role = req.user && req.user.role;
    if (['ceo', 'admin', 'super_admin', 'manager'].includes(role)) return next();
    const staff = await getCafeRole(req.user.tenantId, req.user.sub);
    if (!staff) {
      return res.status(403).json({ error: 'Kitchen access: cafe staff only' });
    }
    req.cafeStaff = staff;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Cafe access check failed' });
  }
}

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'CafeStaff', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// GET / — cafe staff list (role/active filters)
router.get('/', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { role, active } = req.query;
    const where = { ...tf };
    if (role && CAFE_ROLES.includes(role)) where.role = role;
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    const staff = await prisma.cafeStaff.findMany({
      where,
      include: { employee: { select: { id: true, name: true, email: true, phone: true, department: true, designation: true, status: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({
      staff: staff.map((s) => ({
        id: s.id, role: s.role, roleLabel: CAFE_ROLE_LABELS[s.role] || s.role,
        isActive: s.isActive, createdAt: s.createdAt, employee: s.employee,
      })),
      total: staff.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load cafe staff' });
  }
});

// GET /me — meri khud ki cafe role (kitchen display login check ke liye)
router.get('/me', async (req, res) => {
  try {
    const staff = await getCafeRole(req.user.tenantId, req.user.sub);
    res.json({ cafeStaff: staff ? { id: staff.id, role: staff.role, roleLabel: CAFE_ROLE_LABELS[staff.role] || staff.role } : null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load cafe role' });
  }
});

const assignSchema = z.object({
  employeeId: z.string().cuid(),
  role: z.enum(CAFE_ROLES),
});

// POST /assign — employee ko cafe role do (upsert: ek employee ek hi cafe role)
router.post('/assign', hrOnly, validateBody(assignSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { employeeId, role } = req.body;
    const employee = await prisma.employee.findFirst({
      where: { ...tf, id: employeeId },
      select: { id: true, name: true, status: true },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (employee.status !== 'active') return res.status(422).json({ error: 'Employee is not active' });
    const staff = await prisma.cafeStaff.upsert({
      where: { employeeId },
      create: { tenantId: tf.tenantId, employeeId, role, isActive: true },
      update: { role, isActive: true },
      include: { employee: { select: { id: true, name: true } } },
    });
    audit(req, tf, 'cafe_staff.assign', staff.id, { employeeId, role });
    res.status(201).json({
      cafeStaff: { id: staff.id, role: staff.role, isActive: staff.isActive, employee: staff.employee },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign cafe role' });
  }
});

const updateSchema = z.object({
  role: z.enum(CAFE_ROLES).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /:id — role change ya deactivate
router.patch('/:id', hrOnly, validateBody(updateSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.cafeStaff.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Cafe staff record not found' });
    const staff = await prisma.cafeStaff.update({
      where: { id: req.params.id },
      data: { ...(req.body.role ? { role: req.body.role } : {}), ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}) },
      include: { employee: { select: { id: true, name: true } } },
    });
    audit(req, tf, 'cafe_staff.update', staff.id, { role: staff.role, isActive: staff.isActive });
    res.json({ cafeStaff: { id: staff.id, role: staff.role, isActive: staff.isActive, employee: staff.employee } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update cafe staff' });
  }
});

// POST /:id/deactivate — quick deactivate
router.post('/:id/deactivate', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.cafeStaff.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Cafe staff record not found' });
    const staff = await prisma.cafeStaff.update({ where: { id: req.params.id }, data: { isActive: false } });
    audit(req, tf, 'cafe_staff.deactivate', staff.id, {});
    res.json({ ok: true, isActive: false });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate cafe staff' });
  }
});

module.exports = router;
module.exports.getCafeRole = getCafeRole;
module.exports.requireCafeAccess = requireCafeAccess;
module.exports.CAFE_ROLES = CAFE_ROLES;
