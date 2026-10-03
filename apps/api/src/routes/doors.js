// Phase 48 Track 1/10: Doors & Access Points.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/doors', require('./routes/doors'));
// NOTE: Door model track ke doors.prisma fragment se aata hai —
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
  return typeof prisma.door?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'doors migration pending' });
  next();
}
router.use(guard);

const doorSchema = z.object({
  name: z.string().min(2).max(80),
  location: z.string().max(120).optional().nullable(),
  deviceId: z.string().max(80).optional().nullable(),
  type: z.enum(['entrance', 'internal', 'exit']).default('internal'),
  isActive: z.boolean().default(true).optional(),
});

// GET /api/doors — list (active first, then name)
router.get('/', requireRole('ceo', 'admin', 'super_admin', 'manager'), async (req, res, next) => {
  try {
    const doors = await prisma.door.findMany({
      where: { ...tenantFilter(req) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    res.json({ doors });
  } catch (err) { next(err); }
});

// GET /api/doors/:id
router.get('/:id', requireRole('ceo', 'admin', 'super_admin', 'manager'), async (req, res, next) => {
  try {
    const door = await prisma.door.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!door) return res.status(404).json({ error: 'Door not found' });
    res.json({ door });
  } catch (err) { next(err); }
});

// POST /api/doors — create
router.post('/', requireRole('ceo', 'admin', 'super_admin', 'manager'), async (req, res, next) => {
  try {
    const body = doorSchema.parse(req.body || {});
    const { tenantId } = tenantFilter(req);
    const door = await prisma.door.create({
      data: { tenantId, ...body },
    });
    writeAudit({
      tenantId, actorId: req.user.id, action: 'door.create', entity: 'Door',
      entityId: door.id, newValue: { name: door.name, type: door.type },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.status(201).json({ door });
  } catch (err) { next(err); }
});

// PATCH /api/doors/:id — update
router.patch('/:id', requireRole('ceo', 'admin', 'super_admin', 'manager'), async (req, res, next) => {
  try {
    const body = doorSchema.partial().parse(req.body || {});
    const { tenantId } = tenantFilter(req);
    const existing = await prisma.door.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Door not found' });
    const door = await prisma.door.update({
      where: { id: existing.id },
      data: body,
    });
    writeAudit({
      tenantId, actorId: req.user.id, action: 'door.update', entity: 'Door',
      entityId: door.id, oldValue: { name: existing.name, type: existing.type },
      newValue: { name: door.name, type: door.type, isActive: door.isActive },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ door });
  } catch (err) { next(err); }
});

// PATCH /api/doors/:id/active — quick on/off toggle
router.patch('/:id/active', requireRole('ceo', 'admin', 'super_admin', 'manager'), async (req, res, next) => {
  try {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body || {});
    const { tenantId } = tenantFilter(req);
    const existing = await prisma.door.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Door not found' });
    const door = await prisma.door.update({
      where: { id: existing.id },
      data: { isActive },
    });
    writeAudit({
      tenantId, actorId: req.user.id,
      action: isActive ? 'door.activate' : 'door.deactivate',
      entity: 'Door', entityId: door.id, newValue: { isActive },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ door });
  } catch (err) { next(err); }
});

// DELETE /api/doors/:id
router.delete('/:id', requireRole('ceo', 'admin', 'super_admin'), async (req, res, next) => {
  try {
    const { tenantId } = tenantFilter(req);
    const existing = await prisma.door.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Door not found' });
    await prisma.door.delete({ where: { id: existing.id } });
    writeAudit({
      tenantId, actorId: req.user.id, action: 'door.delete', entity: 'Door',
      entityId: existing.id, oldValue: { name: existing.name },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
