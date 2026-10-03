// Phase 43 Track 1: Cafeteria Menu Management.
// Member-visible menu + staff menu builder. Mount: /api/menu (coordinator).
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

function menuEnabled() {
  return !!(prisma && prisma.menuCategory && prisma.menuItem);
}
function guard503(req, res, next) {
  if (!menuEnabled()) return res.status(503).json({ error: 'Menu schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'Menu', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const TAGS = ['veg', 'non_veg', 'vegan', 'spicy', 'gluten_free', 'bestseller'];

const categorySchema = z.object({
  name: z.string().min(1).max(80),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});
const categoryPatch = categorySchema.partial();

const itemSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  price: z.number().positive().max(999999),
  imageUrl: z.string().max(500).optional().nullable(),
  isAvailable: z.boolean().default(true),
  tags: z.array(z.enum(TAGS)).default([]),
  prepTimeMin: z.number().int().min(0).max(240).optional().nullable(),
});
const itemPatch = itemSchema.partial().omit({ categoryId: true });

// GET / — member-facing full menu: active categories + available items, sorted
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const categories = await prisma.menuCategory.findMany({
      where: { ...tf, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        items: {
          where: { isAvailable: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    // avg rating per item (Phase 43 Track 7 — guarded)
    let ratingBy = {};
    try {
      const { getItemRatingSummary } = require('./food-ratings');
      const allIds = categories.flatMap((c) => c.items.map((i) => i.id));
      ratingBy = await getItemRatingSummary(tf.tenantId, allIds);
    } catch { /* ratings merge na ho to skip */ }
    const withRatings = categories.map((c) => ({
      ...c,
      items: c.items.map((i) => ({ ...i, avgRating: ratingBy[i.id]?.avg ?? null, ratingCount: ratingBy[i.id]?.count ?? 0 })),
    }));
    res.json({ categories: withRatings });
  } catch (e) {
    res.status(500).json({ error: 'Menu load nahi ho saka' });
  }
});

// GET /categories — all categories (staff view, incl. inactive)
router.get('/categories', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const categories = await prisma.menuCategory.findMany({
      where: { ...tf },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
    res.json({ categories });
  } catch (e) {
    res.status(500).json({ error: 'Categories load nahi ho sakin' });
  }
});

// POST /categories — staff
router.post('/categories', staffOnly, validateBody(categorySchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const cat = await prisma.menuCategory.create({ data: { ...tf, ...req.body } });
    audit(req, tf, 'menu_category.create', cat.id, cat);
    res.status(201).json({ category: cat });
  } catch (e) {
    res.status(500).json({ error: 'Category create nahi ho saki' });
  }
});

// PATCH /categories/:id — staff
router.patch('/categories/:id', staffOnly, validateBody(categoryPatch), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const cat = await prisma.menuCategory.update({
      where: { id: req.params.id },
      data: req.body,
    });
    if (cat.tenantId !== tf.tenantId) return res.status(404).json({ error: 'Category nahi mili' });
    audit(req, tf, 'menu_category.update', cat.id, req.body);
    res.json({ category: cat });
  } catch (e) {
    res.status(404).json({ error: 'Category nahi mili' });
  }
});

// DELETE /categories/:id — staff (items cascade)
router.delete('/categories/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.menuCategory.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Category nahi mili' });
    await prisma.menuCategory.delete({ where: { id: req.params.id } });
    audit(req, tf, 'menu_category.delete', req.params.id, null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Category delete nahi ho saki' });
  }
});

// GET /items — staff view: all items (?category=, ?available=1/0, ?search=)
router.get('/items', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { category, available, search } = req.query;
    const where = { ...tf };
    if (category) where.categoryId = category;
    if (available === '1') where.isAvailable = true;
    else if (available === '0') where.isAvailable = false;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const items = await prisma.menuItem.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: 'Menu items load nahi ho sake' });
  }
});

// POST /items — staff
router.post('/items', staffOnly, validateBody(itemSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const cat = await prisma.menuCategory.findFirst({ where: { id: req.body.categoryId, ...tf } });
    if (!cat) return res.status(400).json({ error: 'Category isi tenant ki nahi hai' });
    const item = await prisma.menuItem.create({ data: { ...tf, ...req.body } });
    audit(req, tf, 'menu_item.create', item.id, item);
    res.status(201).json({ item });
  } catch (e) {
    res.status(500).json({ error: 'Menu item create nahi ho saka' });
  }
});

// PATCH /items/:id — staff
router.patch('/items/:id', staffOnly, validateBody(itemPatch), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.menuItem.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Item nahi mila' });
    const item = await prisma.menuItem.update({ where: { id: req.params.id }, data: req.body });
    audit(req, tf, 'menu_item.update', item.id, req.body);
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: 'Menu item update nahi ho saka' });
  }
});

// PATCH /items/:id/availability — staff quick toggle
router.patch('/items/:id/availability', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.menuItem.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Item nahi mila' });
    const item = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: { isAvailable: !existing.isAvailable },
    });
    audit(req, tf, 'menu_item.availability', item.id, { isAvailable: item.isAvailable });
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: 'Availability toggle nahi ho saki' });
  }
});

// DELETE /items/:id — staff
router.delete('/items/:id', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.menuItem.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Item nahi mila' });
    await prisma.menuItem.delete({ where: { id: req.params.id } });
    audit(req, tf, 'menu_item.delete', req.params.id, null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Menu item delete nahi ho saka' });
  }
});

module.exports = router;
