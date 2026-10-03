// Phase 34 Track 4: Parking Management.
// Mount (coordinator): app.use('/api/parking', require('./routes/parking'));
// Visual spot grid: free (green) / occupied (red) / reserved (amber).
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

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'operations_manager'];
const staffOnly = requireRole(...STAFF);

const SPOT_TYPES = ['car', 'bike', 'vip'];
const SPOT_STATUSES = ['free', 'occupied', 'reserved'];

const spotSchema = z.object({
  label: z.string().min(1).max(20),
  type: z.enum(SPOT_TYPES).default('car'),
  status: z.enum(SPOT_STATUSES).default('free'),
  notes: z.string().max(500).optional().nullable(),
});

const assignSchema = z.object({
  spotId: z.string().min(1),
  memberId: z.string().min(1),
  vehicleNumber: z.string().max(30).optional().nullable(),
});

const includeAssignment = {
  spot: { select: { id: true, label: true, type: true } },
  member: { select: { id: true, name: true, email: true } },
};

// GET /spots — all spots with active assignment info
router.get('/spots', async (req, res, next) => {
  try {
    const spots = await prisma.parkingSpot.findMany({
      where: tenantFilter(req),
      include: {
        assignments: {
          where: { status: 'active' },
          include: { member: { select: { id: true, name: true } } },
          take: 1,
        },
      },
      orderBy: { label: 'asc' },
    });
    res.json({ spots });
  } catch (e) { next(e); }
});

// POST /spots — add a spot (staff)
router.post('/spots', staffOnly, validateBody(spotSchema), async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const existing = await prisma.parkingSpot.findUnique({
      where: { tenantId_label: { tenantId, label: req.body.label.trim() } },
    });
    if (existing) return res.status(409).json({ error: 'Spot label already exists.' });
    const spot = await prisma.parkingSpot.create({
      data: {
        tenantId,
        label: req.body.label.trim(),
        type: req.body.type,
        status: req.body.status,
        notes: req.body.notes || null,
      },
    });
    await writeAudit(req, { action: 'parking.spot_created', entity: 'ParkingSpot', entityId: spot.id, details: { label: spot.label } }).catch(() => {});
    res.status(201).json({ spot });
  } catch (e) { next(e); }
});

// PATCH /spots/:id — edit spot (staff): label/type/status/notes
router.patch('/spots/:id', staffOnly, validateBody(spotSchema.partial()), async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const spot = await prisma.parkingSpot.findFirst({ where: { id: req.params.id, tenantId } });
    if (!spot) return res.status(404).json({ error: 'Spot not found.' });
    if (req.body.label && req.body.label.trim() !== spot.label) {
      const clash = await prisma.parkingSpot.findUnique({
        where: { tenantId_label: { tenantId, label: req.body.label.trim() } },
      });
      if (clash) return res.status(409).json({ error: 'Spot label already exists.' });
    }
    const updated = await prisma.parkingSpot.update({
      where: { id: spot.id },
      data: {
        ...(req.body.label ? { label: req.body.label.trim() } : {}),
        ...(req.body.type ? { type: req.body.type } : {}),
        ...(req.body.notes !== undefined ? { notes: req.body.notes || null } : {}),
        // status: occupied sirf assignment se set hota hai; free/reserved manual
        ...(req.body.status && req.body.status !== 'occupied' ? { status: req.body.status } : {}),
      },
    });
    await writeAudit(req, { action: 'parking.spot_updated', entity: 'ParkingSpot', entityId: spot.id }).catch(() => {});
    res.json({ spot: updated });
  } catch (e) { next(e); }
});

// DELETE /spots/:id — remove spot with no active assignment (staff)
router.delete('/spots/:id', staffOnly, async (req, res, next) => {
  try {
    const spot = await prisma.parkingSpot.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!spot) return res.status(404).json({ error: 'Spot not found.' });
    const active = await prisma.parkingAssignment.count({ where: { spotId: spot.id, status: 'active' } });
    if (active) return res.status(409).json({ error: 'Cannot delete a spot with an active assignment.' });
    await prisma.parkingSpot.delete({ where: { id: spot.id } });
    await writeAudit(req, { action: 'parking.spot_deleted', entity: 'ParkingSpot', entityId: spot.id }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /assign — assign a free spot to a member (staff)
router.post('/assign', staffOnly, validateBody(assignSchema), async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const { spotId, memberId, vehicleNumber } = req.body;
    const spot = await prisma.parkingSpot.findFirst({ where: { id: spotId, tenantId } });
    if (!spot) return res.status(404).json({ error: 'Spot not found.' });
    if (spot.status === 'occupied') return res.status(409).json({ error: 'Spot is already occupied.' });
    const member = await prisma.member.findFirst({ where: { id: memberId, tenantId } });
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    const existing = await prisma.parkingAssignment.findFirst({
      where: { memberId, status: 'active', tenantId },
    });
    if (existing) return res.status(409).json({ error: 'Member already has an active parking assignment.' });

    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.parkingAssignment.create({
        data: {
          tenantId,
          spotId: spot.id,
          memberId: member.id,
          vehicleNumber: vehicleNumber || null,
        },
        include: includeAssignment,
      });
      await tx.parkingSpot.update({ where: { id: spot.id }, data: { status: 'occupied' } });
      return assignment;
    });
    await writeAudit(req, { action: 'parking.assigned', entity: 'ParkingAssignment', entityId: result.id, details: { spot: spot.label, member: member.name } }).catch(() => {});
    res.status(201).json({ assignment: result });
  } catch (e) { next(e); }
});

// POST /release/:id — end an assignment, free the spot (staff)
router.post('/release/:id', staffOnly, async (req, res, next) => {
  try {
    const assignment = await prisma.parkingAssignment.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { spot: true, member: { select: { name: true } } },
    });
    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
    if (assignment.status !== 'active') return res.status(409).json({ error: 'Assignment is not active.' });

    await prisma.$transaction(async (tx) => {
      await tx.parkingAssignment.update({
        where: { id: assignment.id },
        data: { status: 'ended', endDate: new Date() },
      });
      await tx.parkingSpot.update({ where: { id: assignment.spotId }, data: { status: 'free' } });
    });
    await writeAudit(req, { action: 'parking.released', entity: 'ParkingAssignment', entityId: assignment.id, details: { spot: assignment.spot.label } }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /assignments — active (default) or all assignments
router.get('/assignments', async (req, res, next) => {
  try {
    const status = req.query.status === 'all' ? undefined : 'active';
    const assignments = await prisma.parkingAssignment.findMany({
      where: { ...tenantFilter(req), ...(status ? { status } : {}) },
      include: includeAssignment,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ assignments });
  } catch (e) { next(e); }
});

module.exports = router;
