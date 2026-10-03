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

const UNIT_TYPES = ['hot_desk', 'dedicated_desk', 'cabin', 'meeting_room', 'phone_booth'];
const UNIT_STATUSES = ['vacant', 'occupied', 'maintenance'];

// --------------------------------------------------------------- floors ---
const floorSchema = z.object({
  name: z.string().min(1),
  level: z.number().int().default(0),
  buildingId: z.string().min(1).optional(),
});
const floorUpdateSchema = floorSchema.partial().refine((d) => Object.keys(d).length > 0, {
  message: 'No fields to update',
});

router.get('/floors', read, async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.buildingId) where.buildingId = String(req.query.buildingId);
    const floors = await prisma.floor.findMany({
      where,
      include: { building: { select: { id: true, name: true } }, _count: { select: { zones: true } } },
      orderBy: { level: 'asc' },
    });
    return res.json({ floors });
  } catch (err) {
    return next(err);
  }
});

router.post('/floors', write, validateBody(floorSchema), async (req, res, next) => {
  try {
    if (req.body.buildingId) {
      const building = await prisma.building.findFirst({
        where: { id: req.body.buildingId, ...tenantFilter(req) },
      });
      if (!building) return res.status(400).json({ error: { message: 'Building not found' } });
    }
    const floor = await prisma.floor.create({
      data: { ...tenantFilter(req), ...req.body },
    });
    return res.status(201).json({ floor });
  } catch (err) {
    return next(err);
  }
});

router.get('/floors/:id', read, async (req, res, next) => {
  try {
    const floor = await prisma.floor.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { building: true, zones: { include: { units: true } } },
    });
    if (!floor) return res.status(404).json({ error: { message: 'Floor not found' } });
    return res.json({ floor });
  } catch (err) {
    return next(err);
  }
});

router.patch('/floors/:id', write, validateBody(floorUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.floor.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Floor not found' } });
    if (req.body.buildingId) {
      const building = await prisma.building.findFirst({
        where: { id: req.body.buildingId, ...tenantFilter(req) },
      });
      if (!building) return res.status(400).json({ error: { message: 'Building not found' } });
    }
    const floor = await prisma.floor.update({ where: { id: existing.id }, data: req.body });
    return res.json({ floor });
  } catch (err) {
    return next(err);
  }
});

router.delete('/floors/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.floor.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { _count: { select: { zones: true } } },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Floor not found' } });
    if (existing._count.zones > 0) {
      return res.status(400).json({
        error: { message: 'Cannot delete floor: it still has zones' },
      });
    }
    await prisma.floor.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------- zones ---
const zoneSchema = z.object({ name: z.string().min(1), floorId: z.string().min(1) });
const zoneUpdateSchema = z
  .object({ name: z.string().min(1).optional(), floorId: z.string().min(1).optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

router.get('/zones', read, async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.floorId) where.floorId = String(req.query.floorId);
    const zones = await prisma.zone.findMany({
      where,
      include: { _count: { select: { units: true } } },
      orderBy: { name: 'asc' },
    });
    return res.json({ zones });
  } catch (err) {
    return next(err);
  }
});

router.post('/zones', write, validateBody(zoneSchema), async (req, res, next) => {
  try {
    const floor = await prisma.floor.findFirst({
      where: { id: req.body.floorId, ...tenantFilter(req) },
    });
    if (!floor) return res.status(400).json({ error: { message: 'Floor not found' } });
    const zone = await prisma.zone.create({
      data: { ...tenantFilter(req), ...req.body },
    });
    return res.status(201).json({ zone });
  } catch (err) {
    return next(err);
  }
});

router.patch('/zones/:id', write, validateBody(zoneUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.zone.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Zone not found' } });
    if (req.body.floorId) {
      const floor = await prisma.floor.findFirst({
        where: { id: req.body.floorId, ...tenantFilter(req) },
      });
      if (!floor) return res.status(400).json({ error: { message: 'Floor not found' } });
    }
    const zone = await prisma.zone.update({ where: { id: existing.id }, data: req.body });
    return res.json({ zone });
  } catch (err) {
    return next(err);
  }
});

router.delete('/zones/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.zone.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { _count: { select: { units: true } } },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Zone not found' } });
    if (existing._count.units > 0) {
      return res.status(400).json({
        error: { message: 'Cannot delete zone: it still has units' },
      });
    }
    await prisma.zone.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------- units ---
const unitSchema = z.object({
  code: z.string().min(1),
  type: z.enum(UNIT_TYPES),
  status: z.enum(UNIT_STATUSES).default('vacant'),
  monthlyPrice: z.number().nonnegative(),
  capacity: z.number().int().positive().default(1),
  zoneId: z.string().min(1),
  posX: z.number().int().min(0).default(0),
  posY: z.number().int().min(0).default(0),
});
const unitUpdateSchema = z
  .object({
    code: z.string().min(1).optional(),
    type: z.enum(UNIT_TYPES).optional(),
    status: z.enum(UNIT_STATUSES).optional(),
    monthlyPrice: z.number().nonnegative().optional(),
    capacity: z.number().int().positive().optional(),
    zoneId: z.string().min(1).optional(),
    posX: z.number().int().min(0).optional(),
    posY: z.number().int().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

router.get('/units', read, async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.zoneId) where.zoneId = String(req.query.zoneId);
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    const units = await prisma.unit.findMany({
      where,
      include: { zone: { include: { floor: { include: { building: true } } } } },
      orderBy: { code: 'asc' },
    });

    const myId = req.user.sub || req.user.id;
    // Favorites for current user
    const favs = await prisma.unitFavorite.findMany({
      where: { tenantId: req.user.tenantId, userId: myId },
      select: { unitId: true },
    });
    const favSet = new Set(favs.map((f) => f.unitId));

    // Availability check for a date range: unit is unavailable if any confirmed
    // booking overlaps [from, to)
    let busySet = new Set();
    if (req.query.from && req.query.to) {
      const from = new Date(String(req.query.from));
      const to = new Date(String(req.query.to));
      if (!isNaN(from) && !isNaN(to) && from < to) {
        const clashes = await prisma.booking.findMany({
          where: {
            ...tenantFilter(req),
            status: 'confirmed',
            startAt: { lt: to },
            endAt: { gt: from },
          },
          select: { unitId: true },
        });
        busySet = new Set(clashes.map((b) => b.unitId));
      }
    }

    const shaped = units.map((u) => ({
      ...u,
      monthlyPrice: Number(u.monthlyPrice),
      isFavorite: favSet.has(u.id),
      isAvailable: !busySet.has(u.id),
      buildingName: u.zone?.floor?.building?.name || null,
    }));
    return res.json({ units: shaped });
  } catch (err) {
    return next(err);
  }
});

// Toggle favorite
router.post('/units/:id/favorite', read, async (req, res, next) => {
  try {
    const myId = req.user.sub || req.user.id;
    const unit = await prisma.unit.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!unit) return res.status(404).json({ error: { message: 'Unit not found' } });
    const existing = await prisma.unitFavorite.findFirst({
      where: { tenantId: req.user.tenantId, unitId: unit.id, userId: myId },
    });
    if (existing) {
      await prisma.unitFavorite.delete({ where: { id: existing.id } });
      return res.json({ isFavorite: false });
    }
    await prisma.unitFavorite.create({
      data: { tenantId: req.user.tenantId, unitId: unit.id, userId: myId },
    });
    return res.json({ isFavorite: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/units', write, validateBody(unitSchema), async (req, res, next) => {
  try {
    const zone = await prisma.zone.findFirst({
      where: { id: req.body.zoneId, ...tenantFilter(req) },
    });
    if (!zone) return res.status(400).json({ error: { message: 'Zone not found' } });
    const unit = await prisma.unit.create({
      data: { ...tenantFilter(req), ...req.body },
    });
    return res.status(201).json({ unit });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return res.status(400).json({
        error: { message: 'Unit code is already in use for this tenant' },
      });
    }
    return next(err);
  }
});

router.get('/units/:id', read, async (req, res, next) => {
  try {
    const unit = await prisma.unit.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { zone: { include: { floor: { include: { building: true } } } } },
    });
    if (!unit) return res.status(404).json({ error: { message: 'Unit not found' } });
    return res.json({ unit });
  } catch (err) {
    return next(err);
  }
});

router.patch('/units/:id', write, validateBody(unitUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.unit.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Unit not found' } });
    if (req.body.zoneId) {
      const zone = await prisma.zone.findFirst({
        where: { id: req.body.zoneId, ...tenantFilter(req) },
      });
      if (!zone) return res.status(400).json({ error: { message: 'Zone not found' } });
    }
    const unit = await prisma.unit.update({ where: { id: existing.id }, data: req.body });
    return res.json({ unit });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return res.status(400).json({
        error: { message: 'Unit code is already in use for this tenant' },
      });
    }
    return next(err);
  }
});

router.delete('/units/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.unit.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Unit not found' } });
    const activeContracts = await prisma.contract.count({
      where: { unitId: existing.id, status: 'active' },
    });
    if (activeContracts > 0) {
      return res.status(400).json({
        error: { message: 'Cannot delete unit: it has active contracts' },
      });
    }
    await prisma.unit.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------ occupancy ---
router.get('/occupancy', read, async (req, res, next) => {
  try {
    const floors = await prisma.floor.findMany({
      where: tenantFilter(req),
      include: { zones: { include: { units: { select: { status: true } } } } },
      orderBy: { level: 'asc' },
    });
    const perFloor = floors.map((f) => {
      const units = f.zones.flatMap((z) => z.units);
      const total = units.length;
      const occupied = units.filter((u) => u.status === 'occupied').length;
      const vacant = units.filter((u) => u.status === 'vacant').length;
      const maintenance = units.filter((u) => u.status === 'maintenance').length;
      return {
        floorId: f.id,
        name: f.name,
        total,
        occupied,
        vacant,
        maintenance,
        rate: total ? occupied / total : 0,
      };
    });
    const total = perFloor.reduce((s, f) => s + f.total, 0);
    const occupied = perFloor.reduce((s, f) => s + f.occupied, 0);
    return res.json({
      floors: perFloor,
      overall: { total, occupied, rate: total ? occupied / total : 0 },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
