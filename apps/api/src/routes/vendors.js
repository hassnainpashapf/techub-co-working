// Phase 41 Track 1: Vendor Management.
// Staff CRUD + search/category filter. Mount: /api/vendors (coordinator).
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

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'finance'];
const staffOnly = requireRole(...STAFF);

function vendorsEnabled() {
  return !!(prisma && prisma.vendor);
}
function guard503(req, res, next) {
  if (!vendorsEnabled()) return res.status(503).json({ error: 'Vendor schema pending migration' });
  next();
}
router.use(guard503);

const CATEGORIES = ['maintenance', 'food', 'it', 'office', 'other'];
const PAYMENT_TERMS = ['net_15', 'net_30', 'cod'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'Vendor', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const vendorSchema = z.object({
  name: z.string().min(1).max(160),
  company: z.string().max(160).optional().nullable(),
  email: z.string().email().max(160).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  category: z.enum(CATEGORIES).default('other'),
  paymentTerms: z.enum(PAYMENT_TERMS).default('net_30'),
  taxId: z.string().max(60).optional().nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
});

const patchSchema = vendorSchema.partial();

// GET / — vendor directory (search + category + active filters)
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { search, category, active } = req.query;
    const where = { ...tf };
    if (category && CATEGORIES.includes(category)) where.category = category;
    if (active === '1') where.isActive = true;
    else if (active === '0') where.isActive = false;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    const vendors = await prisma.vendor.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ vendors });
  } catch (e) {
    res.status(500).json({ error: 'Vendors load nahi ho sake' });
  }
});

// POST / — create vendor
router.post('/', staffOnly, validateBody(vendorSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const vendor = await prisma.vendor.create({ data: { ...req.body, ...tf } });
    audit(req, tf, 'vendor.create', vendor.id, { name: vendor.name });
    res.status(201).json({ vendor });
  } catch (e) {
    res.status(500).json({ error: 'Vendor create nahi ho saka' });
  }
});

// PATCH /:id — update vendor
router.patch('/:id', staffOnly, validateBody(patchSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Vendor nahi mila' });
    const vendor = await prisma.vendor.update({ where: { id: existing.id }, data: req.body });
    audit(req, tf, 'vendor.update', vendor.id, { name: vendor.name });
    res.json({ vendor });
  } catch (e) {
    res.status(500).json({ error: 'Vendor update nahi ho saka' });
  }
});

// PATCH /:id/rating — vendor performance rating (Track 8 extend karega: auto-rating engine)
// Placeholder: manual rating 0-5; track 8 se auto-compute overlay hoga.
router.patch('/:id/rating', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const rating = Number(req.body.rating);
    if (Number.isNaN(rating) || rating < 0 || rating > 5) {
      return res.status(400).json({ error: 'Rating 0 se 5 ke darmiyan honi chahiye' });
    }
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Vendor nahi mila' });
    const vendor = await prisma.vendor.update({ where: { id: existing.id }, data: { rating } });
    audit(req, tf, 'vendor.rating', vendor.id, { rating });
    res.json({ vendor });
  } catch (e) {
    res.status(500).json({ error: 'Rating save nahi ho saki' });
  }
});

// DELETE / — soft delete (isActive=false)
router.delete('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Vendor nahi mila' });
    await prisma.vendor.update({ where: { id: existing.id }, data: { isActive: false } });
    audit(req, tf, 'vendor.deactivate', existing.id, { name: existing.name });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Vendor deactivate nahi ho saka' });
  }
});

// ============================================================
// Phase 41 Track 8: Vendor Performance Ratings (additive)
// POST /:id/rate, GET /:id/ratings, GET /:id/performance
// ============================================================

const CRITERIA = ['quality', 'timeliness', 'price'];
const ratingSchema = z.object({
  score: z.number().int().min(1).max(5),
  criteria: z.enum(CRITERIA).default('quality'),
  comment: z.string().max(1000).optional().nullable(),
});

function ratingsEnabled() {
  return !!(prisma && prisma.vendorRating);
}

async function recomputeVendorRating(tf, vendorId) {
  if (!ratingsEnabled()) return;
  try {
    const agg = await prisma.vendorRating.aggregate({
      where: { vendorId, ...tf },
      _avg: { score: true },
    });
    const avg = agg._avg.score;
    await prisma.vendor.update({
      where: { id: vendorId },
      data: { rating: avg == null ? null : Number(avg.toFixed(2)) },
    });
  } catch (_) {}
}

// POST /:id/rate — vendor ko rate karo (per user ek rating, dobara = update)
router.post('/:id/rate', staffOnly, validateBody(ratingSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!ratingsEnabled()) return res.status(503).json({ error: 'Rating schema pending migration' });
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Vendor nahi mila' });
    const rating = await prisma.vendorRating.upsert({
      where: { vendorId_ratedBy: { vendorId: existing.id, ratedBy: req.user.sub } },
      update: { ...req.body, ratedAt: new Date() },
      create: { vendorId: existing.id, ratedBy: req.user.sub, tenantId: tf.tenantId, ...req.body },
    });
    await recomputeVendorRating(tf, existing.id);
    audit(req, tf, 'vendor.rate', existing.id, { score: rating.score, criteria: rating.criteria });
    const vendor = await prisma.vendor.findFirst({ where: { id: existing.id, ...tf } });
    res.status(201).json({ rating, vendorRating: vendor ? vendor.rating : null });
  } catch (e) {
    res.status(500).json({ error: 'Rating save nahi ho saki' });
  }
});

// GET /:id/ratings — vendor ki tamam ratings + avg per criteria
router.get('/:id/ratings', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!ratingsEnabled()) return res.status(503).json({ error: 'Rating schema pending migration' });
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Vendor nahi mila' });
    const ratings = await prisma.vendorRating.findMany({
      where: { vendorId: existing.id, ...tf },
      orderBy: { ratedAt: 'desc' },
      include: { rater: { select: { id: true, name: true, email: true } } },
    });
    const byCriteria = {};
    for (const c of CRITERIA) {
      const rows = ratings.filter((r) => r.criteria === c);
      byCriteria[c] = {
        count: rows.length,
        avg: rows.length ? Number((rows.reduce((s, r) => s + r.score, 0) / rows.length).toFixed(2)) : null,
      };
    }
    res.json({ ratings, avgRating: existing.rating, byCriteria });
  } catch (e) {
    res.status(500).json({ error: 'Ratings load nahi ho sakeen' });
  }
});

// GET /:id/performance — auto signals: on-time delivery %, dispute count,
// total POs, total spend, avg rating (har signal guarded — model na ho to skip)
router.get('/:id/performance', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const vendor = await prisma.vendor.findFirst({ where: { id: req.params.id, ...tf } });
    if (!vendor) return res.status(404).json({ error: 'Vendor nahi mila' });

    let avgRating = vendor.rating != null ? Number(vendor.rating) : null;
    let ratingCount = 0;
    if (ratingsEnabled()) {
      try {
        ratingCount = await prisma.vendorRating.count({ where: { vendorId: vendor.id, ...tf } });
      } catch (_) {}
    }

    // PO stats (guarded)
    let totalPOs = null, totalSpend = null, receivedPOs = null;
    if (prisma.purchaseOrder) {
      try {
        const pos = await prisma.purchaseOrder.findMany({
          where: { vendorId: vendor.id, ...tf },
          select: { status: true, total: true },
        });
        totalPOs = pos.length;
        totalSpend = pos.reduce((s, p) => s + Number(p.total || 0), 0);
        receivedPOs = pos.filter((p) => p.status === 'received' || p.status === 'closed').length;
      } catch (_) {}
    }

    // On-time delivery % — GRN se: discrepancies == null/empty = smooth delivery
    // (GRN model me expected-date field nahi hai, is liye smooth-delivery proxy)
    let onTime = null;
    if (prisma.goodsReceipt && prisma.purchaseOrder) {
      try {
        const receipts = await prisma.goodsReceipt.findMany({
          where: { purchaseOrder: { vendorId: vendor.id }, ...tf },
          select: { discrepancies: true, status: true },
        });
        if (receipts.length) {
          const smooth = receipts.filter((g) => !g.discrepancies || !g.discrepancies.trim()).length;
          onTime = Math.round((smooth / receipts.length) * 100);
        }
      } catch (_) {}
    }

    // Dispute count (guarded — track 4 ka VendorBill model merge na hua ho to skip)
    let disputes = null;
    if (prisma.vendorBill) {
      try {
        disputes = await prisma.vendorBill.count({ where: { vendorId: vendor.id, status: 'disputed', ...tf } });
      } catch (_) {}
    }

    res.json({
      vendorId: vendor.id,
      avgRating,
      ratingCount,
      totalPOs,
      receivedPOs,
      totalSpend,
      onTimeDeliveryPct: onTime,
      disputedBills: disputes,
    });
  } catch (e) {
    res.status(500).json({ error: 'Performance load nahi ho saka' });
  }
});

module.exports = router;
