// Phase 43 Track 5: Delivery Zones.
// Staff CRUD + member GET (active zones for order-form dropdown).
// Mount: app.use('/api/delivery-zones', require('./routes/delivery-zones')); (coordinator)
//
// INTEGRATION NOTES (coordinator):
// 1) Track 2 (food-orders): order form me zone dropdown jorna —
//    GET /api/delivery-zones/active? se active zones lao, POST /api/food-orders body me
//    `deliveryZoneId` (ya existing `deliveryZone` text field me zone ka naam) bhejo.
// 2) Track 3 (kitchen display): order card par zone ka naam dikhana —
//    GET /api/delivery-zones/:id (single) ya orders join me zone name include kare.
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

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

function zonesEnabled() {
  return !!(prisma && prisma.deliveryZone);
}
function guard503(req, res, next) {
  if (!zonesEnabled()) return res.status(503).json({ error: 'Delivery zones schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'DeliveryZone', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const zoneSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional().nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});
const patchSchema = zoneSchema.partial();

// GET / — staff list (sab zones) / member list (sirf active)
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const staff = STAFF.includes(req.user.role);
    const where = { ...tf };
    if (!staff) where.isActive = true;
    if (staff && req.query.active === '1') where.isActive = true;
    if (staff && req.query.active === '0') where.isActive = false;
    const zones = await prisma.deliveryZone.findMany({
      where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ zones });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load delivery zones' });
  }
});

// GET /active — member-friendly shortcut for order form dropdown
router.get('/active', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const zones = await prisma.deliveryZone.findMany({
      where: { ...tf, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, description: true },
    });
    res.json({ zones });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load delivery zones' });
  }
});

// GET /:id — single (kitchen display ke liye zone name resolve)
router.get('/:id', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const zone = await prisma.deliveryZone.findFirst({
      where: { ...tf, id: req.params.id },
    });
    if (!zone) return res.status(404).json({ error: 'Zone not found' });
    res.json({ zone });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load zone' });
  }
});

// POST / — create (staff)
router.post('/', staffOnly, validateBody(zoneSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const zone = await prisma.deliveryZone.create({
      data: { ...tf, ...req.body },
    });
    audit(req, tf, 'delivery_zone.create', zone.id, { name: zone.name });
    res.status(201).json({ zone });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create zone' });
  }
});

// PATCH /:id — update (staff)
router.patch('/:id', staffOnly, validateBody(patchSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const zone = await prisma.deliveryZone.findFirst({
      where: { ...tf, id: req.params.id },
    });
    if (!zone) return res.status(404).json({ error: 'Zone not found' });
    const updated = await prisma.deliveryZone.update({
      where: { id: zone.id }, data: req.body,
    });
    audit(req, tf, 'delivery_zone.update', zone.id, req.body);
    res.json({ zone: updated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update zone' });
  }
});

// DELETE /:id — delete (staff); orders me use ho rahi ho to soft-deactivate
router.delete('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const zone = await prisma.deliveryZone.findFirst({
      where: { ...tf, id: req.params.id },
    });
    if (!zone) return res.status(404).json({ error: 'Zone not found' });
    let inUse = false;
    if (prisma.foodOrder) {
      const n = await prisma.foodOrder.count({
        where: { ...tf, deliveryZoneId: zone.id },
      });
      inUse = n > 0;
    }
    if (inUse) {
      await prisma.deliveryZone.update({ where: { id: zone.id }, data: { isActive: false } });
      audit(req, tf, 'delivery_zone.deactivate', zone.id, { reason: 'in_use' });
      return res.json({ deactivated: true, message: 'Zone in use by orders — deactivated instead' });
    }
    await prisma.deliveryZone.delete({ where: { id: zone.id } });
    audit(req, tf, 'delivery_zone.delete', zone.id, null);
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete zone' });
  }
});

module.exports = router;
