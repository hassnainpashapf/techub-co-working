// Phase 48 Track 4/10: Access Schedules CRUD + live entry check.
// Mount: app.use('/api/access-schedules', require('./routes/access-schedules'));
// Staff roles: ceo / admin / super_admin / manager. Sidebar link nahi — access section extend hai.
// canEnter engine lib/accessCheck.js me hai (test endpoint neeche).

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { canEnter } = require('../lib/accessCheck');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

function schedulesEnabled() {
  return !!(prisma && prisma.accessSchedule);
}
function guard503(req, res, next) {
  if (!schedulesEnabled()) return res.status(503).json({ error: 'Access schedules schema pending migration' });
  next();
}
router.use(guard503);

const DAYS = z.array(z.number().int().min(1).max(7)).min(1).max(7);
const HHMM = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'startTime/endTime "HH:mm" me hon');

const scheduleSchema = z.object({
  memberId: z.string().min(1).nullable().optional(),
  doorId: z.string().min(1).nullable().optional(),
  daysOfWeek: DAYS,
  startTime: HHMM,
  endTime: HHMM,
  isActive: z.boolean().optional(),
});
const schedulePatchSchema = scheduleSchema.partial();

// ---- GET / : sab schedules (filters: memberId, doorId, active) ----
router.get('/', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { memberId, doorId, active } = req.query;
    const where = { ...tf };
    if (memberId) where.memberId = memberId === 'null' ? null : String(memberId);
    if (doorId) where.doorId = doorId === 'null' ? null : String(doorId);
    if (active === '1') where.isActive = true;
    if (active === '0') where.isActive = false;
    const list = await prisma.accessSchedule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        member: { select: { id: true, name: true } },
        door: { select: { id: true, name: true } },
      },
    });
    res.json({ schedules: list });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load schedules' });
  }
});

// ---- GET /test : live entry check (memberId + doorId required) ----
// access-logs / door-unlock routes isay use kar sakti hain.
router.get('/test', staffOnly, async (req, res) => {
  try {
    const { memberId, doorId, at } = req.query;
    if (!memberId || !doorId) return res.status(400).json({ error: 'memberId aur doorId lazmi hain' });
    const tf = tenantFilter(req);
    const result = await canEnter(tf.tenantId, String(memberId), String(doorId), at ? new Date(at) : undefined);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Access check failed' });
  }
});

// ---- GET /:id ----
router.get('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const s = await prisma.accessSchedule.findFirst({
      where: { id: req.params.id, ...tf },
      include: {
        member: { select: { id: true, name: true } },
        door: { select: { id: true, name: true } },
      },
    });
    if (!s) return res.status(404).json({ error: 'Schedule nahi mila' });
    res.json({ schedule: s });
  } catch {
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

// ---- POST / : naya schedule ----
router.post('/', staffOnly, validateBody(scheduleSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const data = req.body;
    // member/door tenant ke hon (agar diye hon)
    if (data.memberId) {
      const m = await prisma.member.findFirst({ where: { id: data.memberId, ...tf }, select: { id: true } });
      if (!m) return res.status(404).json({ error: 'Member nahi mila' });
    }
    if (data.doorId) {
      if (!prisma.door) return res.status(503).json({ error: 'Doors schema pending migration' });
      const d = await prisma.door.findFirst({ where: { id: data.doorId, ...tf }, select: { id: true } });
      if (!d) return res.status(404).json({ error: 'Door nahi mila' });
    }
    const s = await prisma.accessSchedule.create({
      data: { ...data, tenantId: tf.tenantId },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user?.id, action: 'access_schedule.create',
      entity: 'AccessSchedule', entityId: s.id, newValue: { memberId: s.memberId, doorId: s.doorId },
    }).catch(() => {});
    res.status(201).json({ schedule: s });
  } catch (err) {
    res.status(500).json({ error: 'Schedule banane me nakami' });
  }
});

// ---- PATCH /:id ----
router.patch('/:id', staffOnly, validateBody(schedulePatchSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.accessSchedule.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Schedule nahi mila' });
    const s = await prisma.accessSchedule.update({
      where: { id: req.params.id },
      data: { ...req.body },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user?.id, action: 'access_schedule.update',
      entity: 'AccessSchedule', entityId: s.id, oldValue: { isActive: existing.isActive }, newValue: { ...req.body },
    }).catch(() => {});
    res.json({ schedule: s });
  } catch {
    res.status(500).json({ error: 'Schedule update me nakami' });
  }
});

// ---- DELETE /:id ----
router.delete('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.accessSchedule.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Schedule nahi mila' });
    await prisma.accessSchedule.delete({ where: { id: req.params.id } });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user?.id, action: 'access_schedule.delete',
      entity: 'AccessSchedule', entityId: req.params.id,
    }).catch(() => {});
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Schedule delete me nakami' });
  }
});

module.exports = router;
