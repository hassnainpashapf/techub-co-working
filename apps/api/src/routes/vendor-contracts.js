// Phase 41 Track 9: Vendor Contract Expiry Tracking — CRUD + expiring list + renew.
// Mount (coordinator): app.use('/api/vendor-contracts', require('./routes/vendor-contracts'));
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

const FIN_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'finance'];
const finOnly = requireRole(...FIN_ROLES);

const STATUSES = ['active', 'expired'];

const contractSchema = z.object({
  vendorId: z.string().min(1),
  title: z.string().min(1).max(200),
  startDate: z.string().min(1).optional().nullable(),
  endDate: z.string().min(1),
  value: z.number().nonnegative().optional().nullable(),
  autoRenew: z.boolean().optional().default(false),
  documentUrl: z.string().max(2000).optional().nullable(),
  reminderDays: z.number().int().min(1).max(365).optional().default(30),
});

function missingSchema(req, res, next) {
  if (typeof prisma.vendorContract === 'undefined') {
    return res.status(503).json({ error: { message: 'Vendor contracts schema not merged yet. Deploy pending.' } });
  }
  next();
}

const INCLUDE = { vendor: { select: { id: true, name: true, company: true, email: true, phone: true } } };

function daysLeftOf(endDate) {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}
function expiryStatus(daysLeft) {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'expiring';
  return 'valid';
}
function withComputed(c) {
  const daysLeft = daysLeftOf(c.endDate);
  return { ...c, daysLeft, expiryStatus: expiryStatus(daysLeft) };
}

// Expiring soon (?days=30) — expired excluded, expiryStatus computed
router.get('/expiring', finOnly, missingSchema, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const tf = tenantFilter(req);
    const rows = await prisma.vendorContract.findMany({
      where: { ...tf, status: 'active', endDate: { lte: new Date(Date.now() + days * 24 * 60 * 60 * 1000) } },
      include: INCLUDE,
      orderBy: { endDate: 'asc' },
    });
    res.json({ contracts: rows.map(withComputed) });
  } catch (e) { next(e); }
});

// Stats
router.get('/stats', finOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const counts = await prisma.vendorContract.groupBy({ by: ['status'], where: tf, _count: { _all: true } });
    const soon = await prisma.vendorContract.count({
      where: { ...tf, status: 'active', endDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), gte: new Date() } },
    });
    const totalValue = await prisma.vendorContract.aggregate({
      where: { ...tf, status: 'active' }, _sum: { value: true },
    });
    res.json({
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      expiring30d: soon,
      activeValue: Number(totalValue._sum.value || 0),
    });
  } catch (e) { next(e); }
});

// List
router.get('/', finOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status && STATUSES.includes(String(req.query.status))) where.status = String(req.query.status);
    if (req.query.vendorId) where.vendorId = String(req.query.vendorId);
    const rows = await prisma.vendorContract.findMany({ where, include: INCLUDE, orderBy: { endDate: 'asc' } });
    res.json({ contracts: rows.map(withComputed) });
  } catch (e) { next(e); }
});

// Create
router.post('/', finOnly, missingSchema, validateBody(contractSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    // vendor tenant-scoped check
    const vendor = await prisma.vendor.findFirst({ where: { ...tf, id: req.body.vendorId } });
    if (!vendor) return res.status(404).json({ error: { message: 'Vendor not found' } });
    const created = await prisma.vendorContract.create({
      data: {
        tenantId: req.user.tenantId,
        vendorId: vendor.id,
        title: req.body.title,
        startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        endDate: new Date(req.body.endDate),
        value: req.body.value ?? null,
        autoRenew: !!req.body.autoRenew,
        documentUrl: req.body.documentUrl || null,
        reminderDays: req.body.reminderDays ?? 30,
        status: 'active',
      },
      include: INCLUDE,
    });
    await writeAudit(req, 'vendor_contract.create', 'VendorContract', created.id);
    res.status(201).json({ contract: withComputed(created) });
  } catch (e) { next(e); }
});

// Update
router.patch('/:id', finOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.vendorContract.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: 'Contract not found' } });
    const data = {};
    for (const k of ['title', 'startDate', 'endDate', 'value', 'autoRenew', 'documentUrl', 'reminderDays']) {
      if (req.body[k] !== undefined) {
        data[k] = ['startDate', 'endDate'].includes(k) && req.body[k] ? new Date(req.body[k]) : req.body[k];
      }
    }
    // endDate badla to reminder cycle reset
    if (data.endDate) data.lastReminderKey = null;
    const updated = await prisma.vendorContract.update({ where: { id: existing.id }, data, include: INCLUDE });
    await writeAudit(req, 'vendor_contract.update', 'VendorContract', updated.id);
    res.json({ contract: withComputed(updated) });
  } catch (e) { next(e); }
});

// Renew — nayi endDate, status active wapas, reminder cycle reset
router.post('/:id/renew', finOnly, missingSchema, validateBody(z.object({ endDate: z.string().min(1), value: z.number().nonnegative().optional() })), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.vendorContract.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: 'Contract not found' } });
    const updated = await prisma.vendorContract.update({
      where: { id: existing.id },
      data: {
        endDate: new Date(req.body.endDate),
        status: 'active',
        lastReminderKey: null,
        ...(req.body.value !== undefined ? { value: req.body.value } : {}),
      },
      include: INCLUDE,
    });
    await writeAudit(req, 'vendor_contract.renew', 'VendorContract', updated.id);
    res.json({ contract: withComputed(updated) });
  } catch (e) { next(e); }
});

// Delete
router.delete('/:id', finOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.vendorContract.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: 'Contract not found' } });
    await prisma.vendorContract.delete({ where: { id: existing.id } });
    await writeAudit(req, 'vendor_contract.delete', 'VendorContract', existing.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
