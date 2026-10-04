// Phase 55 Track 1: Concierge Service Catalog API.
// Mount (coordinator): app.use('/api/concierge-services', require('./routes/concierge-services'));
//
// Staff (ceo/admin/super_admin/manager):
//   GET    /api/concierge-services?category=&q= -> services list (provider join)
//   POST   /api/concierge-services              -> nayi service
//   PATCH  /api/concierge-services/:id          -> update / toggle active
//   DELETE /api/concierge-services/:id          -> delete (ceo/admin)
// Member (koi bhi tenant user): sirf active services ki list (GET /active).
// NOTE: ConciergeService model Track 1 fragment se, ServiceProvider Track 3 fragment se (merge se pehle 503).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const CATEGORIES = ['errand', 'food', 'transport', 'wellness', 'business'];

// Merge se pehle graceful 503 (koi 500 nahi).
router.use((req, res, next) => {
  if (!prisma.conciergeService || !prisma.serviceProvider) {
    return res.status(503).json({ error: 'concierge_catalog_not_ready' });
  }
  next();
});

const serviceSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(CATEGORIES),
  description: z.string().max(2000).optional().nullable(),
  basePrice: z.number().nonnegative().optional().nullable(),
  providerId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

function staffOnly(...roles) {
  return requireRole(...roles);
}

// ---------- Provider note ----------
// ServiceProvider model + CRUD Track 3 (service-providers.prisma / routes/service-providers.js) ke hain —
// canonical API: GET/POST/PATCH /api/service-providers. ConciergeService.providerId unhi ko reference karta hai.
// Provider picker ke liye: GET /api/service-providers?active=1 (staff), jiska shape { providers: [...] } hai.

// ---------- Services CRUD (staff) ----------

router.get('/', staffOnly(...STAFF_ROLES), async (req, res) => {
  try {
    const { category, q, activeOnly } = req.query;
    const where = { ...tenantFilter(req) };
    if (category && CATEGORIES.includes(category)) where.category = category;
    if (activeOnly === 'true') where.isActive = true;
    if (q) where.name = { contains: q, mode: 'insensitive' };
    const services = await prisma.conciergeService.findMany({
      where,
      include: { provider: { select: { id: true, name: true, phone: true } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    const counts = await prisma.conciergeService.groupBy({
      by: ['category'],
      where: tenantFilter(req),
      _count: { _all: true },
    });
    res.json({ services, counts });
  } catch (e) {
    res.status(500).json({ error: 'services_list_failed' });
  }
});

// ---------- Member: active catalog (koi bhi tenant user) ----------
router.get('/active', async (req, res) => {
  try {
    const where = { ...tenantFilter(req), isActive: true };
    if (req.query.category && CATEGORIES.includes(req.query.category)) where.category = req.query.category;
    const services = await prisma.conciergeService.findMany({
      where,
      include: { provider: { select: { id: true, name: true, phone: true } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json({ services });
  } catch (e) {
    res.status(500).json({ error: 'active_services_failed' });
  }
});

router.post('/', staffOnly(...STAFF_ROLES), async (req, res) => {
  try {
    const data = serviceSchema.parse(req.body);
    // providerId tenant-scoped verify.
    if (data.providerId) {
      const p = await prisma.serviceProvider.findFirst({
        where: { id: data.providerId, ...tenantFilter(req) },
      });
      if (!p) return res.status(404).json({ error: 'provider_not_found' });
    }
    const service = await prisma.conciergeService.create({
      data: { ...data, tenantId: req.user.tenantId },
      include: { provider: { select: { id: true, name: true, phone: true } } },
    });
    await writeAudit(req, { action: 'concierge_service.created', entityId: service.id });
    res.status(201).json({ service });
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(422).json({ error: 'validation_failed', issues: e.issues });
    res.status(500).json({ error: 'service_create_failed' });
  }
});

router.patch('/:id', staffOnly(...STAFF_ROLES), async (req, res) => {
  try {
    const data = serviceSchema.partial().parse(req.body);
    if (data.providerId) {
      const p = await prisma.serviceProvider.findFirst({
        where: { id: data.providerId, ...tenantFilter(req) },
      });
      if (!p) return res.status(404).json({ error: 'provider_not_found' });
    }
    const r = await prisma.conciergeService.updateMany({
      where: { id: req.params.id, ...tenantFilter(req) },
      data,
    });
    if (!r.count) return res.status(404).json({ error: 'service_not_found' });
    await writeAudit(req, { action: 'concierge_service.updated', entityId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(422).json({ error: 'validation_failed', issues: e.issues });
    res.status(500).json({ error: 'service_update_failed' });
  }
});

router.delete('/:id', staffOnly('ceo', 'admin'), async (req, res) => {
  try {
    const r = await prisma.conciergeService.deleteMany({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!r.count) return res.status(404).json({ error: 'service_not_found' });
    await writeAudit(req, { action: 'concierge_service.deleted', entityId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'service_delete_failed' });
  }
});

module.exports = router;
