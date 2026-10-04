// Phase 55 Track 3: Service Providers (concierge partner directory).
// Staff CRUD + search/category filters. Mount: app.use('/api/service-providers', require('./routes/service-providers'))
// COORDINATOR: schema merge hote hi live (ServiceProvider model). Sidebar link nahi — concierge section extend.
// Integration (Track 1 concierge-services page): service form me provider select
//   → GET /api/service-providers?active=1 dropdown; POST/PUT body me providerId set.
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

function enabled() {
  return !!(prisma && prisma.serviceProvider);
}
function guard503(req, res, next) {
  if (!enabled()) return res.status(503).json({ error: 'Concierge schema pending migration' });
  next();
}
router.use(guard503);

const CATEGORIES = ['errand', 'food', 'transport', 'wellness', 'business', 'home', 'other'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'ServiceProvider', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const providerSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.enum(CATEGORIES).default('other'),
  contactName: z.string().max(160).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(160).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  isActive: z.boolean().default(true),
});
const patchSchema = providerSchema.partial();

// GET / — provider directory (search + category + active filters)
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
        { contactName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    const providers = await prisma.serviceProvider.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ providers });
  } catch (e) {
    res.status(500).json({ error: 'Providers load nahi ho sake' });
  }
});

// GET /categories — fixed category list (dropdowns ke liye)
router.get('/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

// POST / — create provider
router.post('/', staffOnly, validateBody(providerSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const p = await prisma.serviceProvider.create({
      data: { ...req.validated, tenantId: tf.tenantId, createdBy: req.user.sub },
    });
    audit(req, tf, 'service_provider.created', p.id, { name: p.name, category: p.category });
    res.status(201).json({ provider: p });
  } catch (e) {
    res.status(500).json({ error: 'Provider create nahi ho saka' });
  }
});

// GET /:id — detail
router.get('/:id', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const p = await prisma.serviceProvider.findFirst({ where: { ...tf, id: req.params.id } });
    if (!p) return res.status(404).json({ error: 'Provider nahi mila' });
    res.json({ provider: p });
  } catch (e) {
    res.status(500).json({ error: 'Provider load nahi ho saka' });
  }
});

// PATCH /:id — update
router.patch('/:id', staffOnly, validateBody(patchSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const found = await prisma.serviceProvider.findFirst({ where: { ...tf, id: req.params.id } });
    if (!found) return res.status(404).json({ error: 'Provider nahi mila' });
    const p = await prisma.serviceProvider.update({ where: { id: found.id }, data: req.validated });
    audit(req, tf, 'service_provider.updated', p.id, req.validated);
    res.json({ provider: p });
  } catch (e) {
    res.status(500).json({ error: 'Provider update nahi ho saka' });
  }
});

// DELETE /:id — hard delete (services Track 1 reference karte hain; coordinator unlink check kare)
router.delete('/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const found = await prisma.serviceProvider.findFirst({ where: { ...tf, id: req.params.id } });
    if (!found) return res.status(404).json({ error: 'Provider nahi mila' });
    if (prisma.conciergeService) {
      const inUse = await prisma.conciergeService.count({
        where: { tenantId: tf.tenantId, providerId: found.id },
      });
      if (inUse > 0) return res.status(409).json({ error: 'Provider services me use ho raha hai — pehle unlink karein' });
    }
    await prisma.serviceProvider.delete({ where: { id: found.id } });
    audit(req, tf, 'service_provider.deleted', found.id, { name: found.name });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Provider delete nahi ho saka' });
  }
});

module.exports = router;
