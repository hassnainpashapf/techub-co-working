// Phase 56 Track 7/10: Locker Maintenance.
// Staff CRUD; maintenance record open hone par locker auto 'reserved' hota hai,
// fixed par locker 'available' wapas (sirf jab wo abhi 'reserved' par ho).
// Mount (coordinator): app.use('/api/locker-maintenance', require('./routes/locker-maintenance'));
// server.js / Sidebar.js nahi chhue. Sidebar link nahi — lockers section extend hai.
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

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'reception'];
const staffOnly = requireRole(...STAFF);
const STAFF_EDIT = ['ceo', 'admin', 'super_admin', 'manager'];
const staffEdit = requireRole(...STAFF_EDIT);

function enabled() {
  return !!(prisma && prisma.lockerMaintenance && prisma.locker);
}
function guard503(req, res, next) {
  if (!enabled()) return res.status(503).json({ error: 'Locker maintenance schema pending migration' });
  next();
}
router.use(guard503);

const STATUSES = ['open', 'fixed'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'LockerMaintenance', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const createSchema = z.object({
  lockerId: z.string().min(1),
  issue: z.string().min(1).max(2000),
  status: z.enum(STATUSES).default('open'),
});
const patchSchema = z.object({
  issue: z.string().min(1).max(2000).optional(),
  status: z.enum(STATUSES).optional(),
});

async function findLocker(req, tf, lockerId) {
  return prisma.locker.findFirst({ where: { id: lockerId, ...tf } });
}

// Maintenance record ki status ke hisab se locker status sync karo.
// open  -> locker 'reserved' (sirf jab wo 'available' par ho)
// fixed -> locker 'available' wapas (sirf jab wo abhi 'reserved' par ho)
async function syncLockerStatus(tf, locker, recordStatus) {
  if (recordStatus === 'open') {
    if (locker.status === 'available') {
      return prisma.locker.update({ where: { id: locker.id }, data: { status: 'reserved' } });
    }
    return null;
  }
  if (recordStatus === 'fixed') {
    if (locker.status === 'reserved') {
      return prisma.locker.update({ where: { id: locker.id }, data: { status: 'available' } });
    }
    return null;
  }
  return null;
}

// GET /api/locker-maintenance — staff list (filters: status, lockerId)
router.get('/', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { status, lockerId } = req.query;
    const where = { ...tf };
    if (status && STATUSES.includes(status)) where.status = status;
    if (lockerId) where.lockerId = lockerId;
    const records = await prisma.lockerMaintenance.findMany({
      where,
      include: {
        locker: { select: { id: true, code: true, location: true, size: true, status: true } },
        reporter: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ status: 'asc' }, { reportedAt: 'desc' }],
    });
    res.json({ records });
  } catch (e) {
    console.error('locker-maintenance list error', e);
    res.status(500).json({ error: 'Maintenance records load nahi ho sake' });
  }
});

// GET /api/locker-maintenance/:id — staff detail
router.get('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const record = await prisma.lockerMaintenance.findFirst({
      where: { id: req.params.id, ...tf },
      include: {
        locker: { select: { id: true, code: true, location: true, size: true, status: true } },
        reporter: { select: { id: true, name: true, email: true } },
      },
    });
    if (!record) return res.status(404).json({ error: 'Maintenance record nahi mila' });
    res.json({ record });
  } catch (e) {
    console.error('locker-maintenance get error', e);
    res.status(500).json({ error: 'Maintenance record load nahi ho saka' });
  }
});

// POST /api/locker-maintenance — staff create (locker auto 'reserved')
router.post('/', staffEdit, validateBody(createSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { lockerId, issue, status } = req.body;
    const locker = await findLocker(req, tf, lockerId);
    if (!locker) return res.status(404).json({ error: 'Locker nahi mila' });

    const record = await prisma.lockerMaintenance.create({
      data: {
        ...tf,
        lockerId: locker.id,
        issue,
        status,
        reportedBy: req.user.sub || null,
        fixedAt: status === 'fixed' ? new Date() : null,
      },
    });
    const synced = await syncLockerStatus(tf, locker, status);
    audit(req, tf, 'locker_maintenance.created', record.id, { lockerId: locker.id, issue, status });
    res.status(201).json({ record, lockerStatus: synced ? synced.status : locker.status });
  } catch (e) {
    console.error('locker-maintenance create error', e);
    res.status(500).json({ error: 'Maintenance record create nahi ho saka' });
  }
});

// PATCH /api/locker-maintenance/:id — staff update (status/fix par locker sync)
router.patch('/:id', staffEdit, validateBody(patchSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const found = await prisma.lockerMaintenance.findFirst({
      where: { id: req.params.id, ...tf },
      include: { locker: true },
    });
    if (!found) return res.status(404).json({ error: 'Maintenance record nahi mila' });

    const data = {};
    if (req.body.issue !== undefined) data.issue = req.body.issue;
    if (req.body.status && req.body.status !== found.status) {
      data.status = req.body.status;
      data.fixedAt = req.body.status === 'fixed' ? new Date() : null;
    }
    const record = await prisma.lockerMaintenance.update({ where: { id: found.id }, data });
    let lockerStatus = found.locker.status;
    if (req.body.status && req.body.status !== found.status) {
      const synced = await syncLockerStatus(tf, found.locker, req.body.status);
      if (synced) lockerStatus = synced.status;
    }
    audit(req, tf, 'locker_maintenance.updated', record.id, { status: record.status });
    res.json({ record, lockerStatus });
  } catch (e) {
    console.error('locker-maintenance patch error', e);
    res.status(500).json({ error: 'Maintenance record update nahi ho saka' });
  }
});

// DELETE /api/locker-maintenance/:id — staff delete (open record delete par locker wapas 'available')
router.delete('/:id', staffEdit, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const found = await prisma.lockerMaintenance.findFirst({
      where: { id: req.params.id, ...tf },
      include: { locker: true },
    });
    if (!found) return res.status(404).json({ error: 'Maintenance record nahi mila' });

    await prisma.lockerMaintenance.delete({ where: { id: found.id } });
    if (found.status === 'open' && found.locker.status === 'reserved') {
      await prisma.locker.update({ where: { id: found.locker.id }, data: { status: 'available' } });
    }
    audit(req, tf, 'locker_maintenance.deleted', found.id, { lockerId: found.lockerId });
    res.json({ deleted: true });
  } catch (e) {
    console.error('locker-maintenance delete error', e);
    res.status(500).json({ error: 'Maintenance record delete nahi ho saka' });
  }
});

module.exports = router;
