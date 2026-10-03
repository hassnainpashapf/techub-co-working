// Phase 51 Track 1/10: Utility Meters.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/meters', require('./routes/meters'));
// NOTE: UtilityMeter model track ke meters.prisma fragment se aata hai —
// migration pending ho to endpoints 503 dete hain (koi crash nahi).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

function modelReady() {
  return typeof prisma.utilityMeter?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'meters migration pending' });
  next();
}
router.use(guard);

const ROLES = ['ceo', 'admin', 'super_admin', 'manager'];

const meterSchema = z.object({
  name: z.string().min(2).max(80),
  type: z.enum(['electricity', 'water', 'gas', 'internet']).default('electricity'),
  unitId: z.string().max(64).optional().nullable(),
  buildingId: z.string().max(64).optional().nullable(),
  meterNumber: z.string().max(60).optional().nullable(),
  isActive: z.boolean().default(true).optional(),
});

async function verifyScope(tenantId, { unitId, buildingId }) {
  if (unitId) {
    const unit = await prisma.unit.findFirst({ where: { id: unitId, tenantId } });
    if (!unit) throw Object.assign(new Error('Unit not found'), { status: 422 });
  }
  if (buildingId) {
    const building = await prisma.building.findFirst({ where: { id: buildingId, tenantId } });
    if (!building) throw Object.assign(new Error('Building not found'), { status: 422 });
  }
}

// GET /api/meters — list (active first, then name)
router.get('/', requireRole(...ROLES), async (req, res, next) => {
  try {
    const { type, unitId, buildingId, active } = req.query || {};
    const where = { ...tenantFilter(req) };
    if (type) where.type = String(type);
    if (unitId) where.unitId = String(unitId);
    if (buildingId) where.buildingId = String(buildingId);
    if (active === '1') where.isActive = true;
    if (active === '0') where.isActive = false;
    const meters = await prisma.utilityMeter.findMany({
      where,
      include: {
        unit: { select: { id: true, code: true } },
        building: { select: { id: true, name: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    res.json({ meters });
  } catch (err) { next(err); }
});

// GET /api/meters/:id
router.get('/:id', requireRole(...ROLES), async (req, res, next) => {
  try {
    const meter = await prisma.utilityMeter.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: {
        unit: { select: { id: true, code: true } },
        building: { select: { id: true, name: true } },
      },
    });
    if (!meter) return res.status(404).json({ error: 'Meter not found' });
    res.json({ meter });
  } catch (err) { next(err); }
});

// POST /api/meters — create
router.post('/', requireRole(...ROLES), async (req, res, next) => {
  try {
    const body = meterSchema.parse(req.body || {});
    const { tenantId } = tenantFilter(req);
    await verifyScope(tenantId, body);
    const meter = await prisma.utilityMeter.create({
      data: { tenantId, ...body },
    });
    writeAudit({
      tenantId, actorId: req.user.id, action: 'meter.create', entity: 'UtilityMeter',
      entityId: meter.id, newValue: { name: meter.name, type: meter.type },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.status(201).json({ meter });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/meters/:id — update
router.patch('/:id', requireRole(...ROLES), async (req, res, next) => {
  try {
    const body = meterSchema.partial().parse(req.body || {});
    const { tenantId } = tenantFilter(req);
    const existing = await prisma.utilityMeter.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Meter not found' });
    await verifyScope(tenantId, { unitId: body.unitId ?? existing.unitId, buildingId: body.buildingId ?? existing.buildingId });
    const meter = await prisma.utilityMeter.update({
      where: { id: existing.id },
      data: body,
    });
    writeAudit({
      tenantId, actorId: req.user.id, action: 'meter.update', entity: 'UtilityMeter',
      entityId: meter.id, oldValue: { name: existing.name, type: existing.type },
      newValue: { name: meter.name, type: meter.type, isActive: meter.isActive },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ meter });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/meters/:id/active — quick on/off toggle
router.patch('/:id/active', requireRole(...ROLES), async (req, res, next) => {
  try {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body || {});
    const { tenantId } = tenantFilter(req);
    const existing = await prisma.utilityMeter.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Meter not found' });
    const meter = await prisma.utilityMeter.update({
      where: { id: existing.id },
      data: { isActive },
    });
    writeAudit({
      tenantId, actorId: req.user.id, action: 'meter.toggle', entity: 'UtilityMeter',
      entityId: meter.id, newValue: { isActive },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ meter });
  } catch (err) { next(err); }
});

// DELETE /api/meters/:id — sirf ceo/admin/super_admin
router.delete('/:id', requireRole('ceo', 'admin', 'super_admin'), async (req, res, next) => {
  try {
    const { tenantId } = tenantFilter(req);
    const existing = await prisma.utilityMeter.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Meter not found' });
    await prisma.utilityMeter.delete({ where: { id: existing.id } });
    writeAudit({
      tenantId, actorId: req.user.id, action: 'meter.delete', entity: 'UtilityMeter',
      entityId: existing.id, oldValue: { name: existing.name, type: existing.type },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
