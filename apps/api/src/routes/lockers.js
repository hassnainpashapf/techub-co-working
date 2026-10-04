// Phase 56 Track 1: Locker Inventory.
// Staff CRUD + status; members available list. Mount: app.use('/api/lockers', require('./routes/lockers'))
// COORDINATOR: schema merge hote hi live (Locker model). Sidebar link neeche diya hai.
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

function enabled() {
  return !!(prisma && prisma.locker);
}
function guard503(req, res, next) {
  if (!enabled()) return res.status(503).json({ error: 'Locker schema pending migration' });
  next();
}
router.use(guard503);

const SIZES = ['S', 'M', 'L', 'XL'];
const STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'Locker', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const lockerSchema = z.object({
  code: z.string().min(1).max(40),
  location: z.string().max(160).optional().nullable(),
  size: z.enum(SIZES).default('M'),
  status: z.enum(STATUSES).default('available'),
  monthlyRate: z.number().min(0).max(10000000).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});
const patchSchema = lockerSchema.partial();

// GET / — staff list (status/size/search filters + counts)
router.get('/', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { status, size, search } = req.query;
    const where = { ...tf };
    if (status && STATUSES.includes(status)) where.status = status;
    if (size && SIZES.includes(size)) where.size = size;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [lockers, counts] = await Promise.all([
      prisma.locker.findMany({ where, orderBy: { code: 'asc' } }),
      prisma.locker.groupBy({ by: ['status'], where: tf, _count: { _all: true } }),
    ]);
    res.json({ lockers, counts });
  } catch (e) {
    res.status(500).json({ error: 'Lockers load nahi ho sake' });
  }
});

// GET /available — member view (sirf available)
router.get('/available', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { size } = req.query;
    const where = { ...tf, status: 'available' };
    if (size && SIZES.includes(size)) where.size = size;
    const lockers = await prisma.locker.findMany({ where, orderBy: { code: 'asc' } });
    res.json({ lockers });
  } catch (e) {
    res.status(500).json({ error: 'Available lockers load nahi ho sake' });
  }
});

// GET /:id
router.get('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const locker = await prisma.locker.findFirst({ where: { ...tf, id: req.params.id } });
    if (!locker) return res.status(404).json({ error: 'Locker nahi mila' });
    res.json({ locker });
  } catch (e) {
    res.status(500).json({ error: 'Locker load nahi ho saka' });
  }
});

// POST / — staff create
router.post('/', staffOnly, validateBody(lockerSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const dup = await prisma.locker.findFirst({ where: { tenantId: tf.tenantId, code: req.validated.code } });
    if (dup) return res.status(409).json({ error: 'Is code ka locker pehle se maujood hai' });
    const locker = await prisma.locker.create({ data: { tenantId: tf.tenantId, ...req.validated } });
    audit(req, tf, 'locker.created', locker.id, { code: locker.code });
    res.status(201).json({ locker });
  } catch (e) {
    if (e && e.code === 'P2002') return res.status(409).json({ error: 'Is code ka locker pehle se maujood hai' });
    res.status(500).json({ error: 'Locker create nahi ho saka' });
  }
});

// PATCH /:id — staff update
router.patch('/:id', staffOnly, validateBody(patchSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const found = await prisma.locker.findFirst({ where: { ...tf, id: req.params.id } });
    if (!found) return res.status(404).json({ error: 'Locker nahi mila' });
    if (req.validated.code && req.validated.code !== found.code) {
      const dup = await prisma.locker.findFirst({ where: { tenantId: tf.tenantId, code: req.validated.code } });
      if (dup) return res.status(409).json({ error: 'Is code ka locker pehle se maujood hai' });
    }
    const locker = await prisma.locker.update({ where: { id: found.id }, data: req.validated });
    audit(req, tf, 'locker.updated', locker.id, req.validated);
    res.json({ locker });
  } catch (e) {
    res.status(500).json({ error: 'Locker update nahi ho saka' });
  }
});

// DELETE /:id — occupied par block
router.delete('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const found = await prisma.locker.findFirst({ where: { ...tf, id: req.params.id } });
    if (!found) return res.status(404).json({ error: 'Locker nahi mila' });
    if (found.status === 'occupied') {
      return res.status(409).json({ error: 'Occupied locker delete nahi ho sakta — pehle status badlein' });
    }
    await prisma.locker.delete({ where: { id: found.id } });
    audit(req, tf, 'locker.deleted', found.id, { code: found.code });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Locker delete nahi ho saka' });
  }
});

module.exports = router;
