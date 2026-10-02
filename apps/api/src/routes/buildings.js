const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const READ_ROLES = [
  'super_admin',
  'ceo',
  'admin',
  'operations_manager',
  'manager',
  'finance_officer',
  'receptionist',
  'office_boy',
  'member',
];
const WRITE_ROLES = ['ceo', 'admin', 'operations_manager', 'manager'];
const write = requireRole(...WRITE_ROLES);
const read = requireRole(...READ_ROLES);

// ------------------------------------------------------------- buildings ---
const buildingSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});
const buildingUpdateSchema = buildingSchema.partial().refine((d) => Object.keys(d).length > 0, {
  message: 'No fields to update',
});

router.get('/', read, async (req, res, next) => {
  try {
    const buildings = await prisma.building.findMany({
      where: tenantFilter(req),
      include: { _count: { select: { floors: true } } },
      orderBy: { name: 'asc' },
    });
    return res.json({ buildings });
  } catch (err) {
    return next(err);
  }
});

router.post('/', write, validateBody(buildingSchema), async (req, res, next) => {
  try {
    const building = await prisma.building.create({
      data: { ...tenantFilter(req), ...req.body },
    });
    return res.status(201).json({ building });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', read, async (req, res, next) => {
  try {
    const building = await prisma.building.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { floors: { include: { _count: { select: { zones: true } } }, orderBy: { level: 'asc' } } },
    });
    if (!building) return res.status(404).json({ error: { message: 'Building not found' } });
    return res.json({ building });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', write, validateBody(buildingUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.building.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Building not found' } });
    const building = await prisma.building.update({ where: { id: existing.id }, data: req.body });
    return res.json({ building });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.building.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { _count: { select: { floors: true } } },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Building not found' } });
    if (existing._count.floors > 0) {
      return res.status(400).json({
        error: { message: 'Cannot delete building: it still has floors' },
      });
    }
    await prisma.building.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
