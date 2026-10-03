const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { checkLowStock } = require('../lib/inventoryAlerts');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'operations_manager'];
const write = requireRole(...WRITE_ROLES);

// --------------------------------------------------------------- inventory ---
const itemSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  category: z.string().default('general'),
  quantity: z.number().int().min(0).default(0),
  unit: z.string().default('pcs'),
  reorderLevel: z.number().int().min(0).default(5),
  unitPrice: z.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const movementSchema = z.object({
  type: z.enum(['in', 'out', 'adjustment']),
  quantity: z.number().int().positive(),
  note: z.string().optional().nullable(),
});

// Phase 29: low-stock alerts — items at or below their reorder level
router.get('/low-stock', async (req, res, next) => {
  try {
    const { getLowStock } = require('../lib/inventoryAlerts');
    const items = await getLowStock(req.user.tenantId);
    res.json({ items, count: items.length });
  } catch (e) { next(e); }
});

router.get('/items', async (req, res, next) => {  try {
    const where = { ...tenantFilter(req) };
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.low === 'true') where.quantity = { lte: 5 };
    if (req.query.search) where.name = { contains: String(req.query.search), mode: 'insensitive' };
    const items = await prisma.inventoryItem.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ items });
  } catch (e) { next(e); }
});

router.post('/items', write, validateBody(itemSchema), async (req, res, next) => {
  try {
    const item = await prisma.inventoryItem.create({
      data: { ...req.body, tenantId: req.user.tenantId },
    });
    await writeAudit(req, 'inventory.create', 'InventoryItem', item.id, null, { name: item.name });
    res.status(201).json({ item });
  } catch (e) { next(e); }
});

router.patch('/items/:id', write, validateBody(itemSchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data: req.body });
    res.json({ item });
  } catch (e) { next(e); }
});

router.post('/items/:id/movements', write, validateBody(movementSchema), async (req, res, next) => {
  try {
    const item = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const { type, quantity, note } = req.body;
    const delta = type === 'out' ? -quantity : quantity;
    const newQty = type === 'adjustment' ? quantity : item.quantity + delta;
    if (newQty < 0) return res.status(400).json({ error: 'Insufficient stock' });
    const [updated, movement] = await prisma.$transaction([
      prisma.inventoryItem.update({ where: { id: item.id }, data: { quantity: newQty } }),
      prisma.inventoryMovement.create({
        data: { tenantId: req.user.tenantId, itemId: item.id, type, quantity, note, createdById: req.user.id },
      }),
    ]);
    res.status(201).json({ item: updated, movement });
    // Phase 29: low-stock auto-check (fire-and-forget, never blocks the response)
    checkLowStock(req.user.tenantId, item.id).catch(() => {});
  } catch (e) { next(e); }
});

router.get('/items/:id/movements', async (req, res, next) => {
  try {
    const movements = await prisma.inventoryMovement.findMany({
      where: { itemId: req.params.id, ...tenantFilter(req) },
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ movements });
  } catch (e) { next(e); }
});

router.delete('/items/:id', write, async (req, res, next) => {
  try {
    const item = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await prisma.inventoryItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ------------------------------------------------------------------ assets ---
const assetSchema = z.object({
  name: z.string().min(1),
  assetTag: z.string().optional().nullable(),
  category: z.string().default('general'),
  status: z.enum(['active', 'in_repair', 'retired', 'lost']).default('active'),
  unitId: z.string().optional().nullable(),
  purchaseDate: z.coerce.date().optional().nullable(),
  purchaseCost: z.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get('/assets', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.search) where.name = { contains: String(req.query.search), mode: 'insensitive' };
    const assets = await prisma.asset.findMany({
      where,
      include: { unit: { select: { id: true, code: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ assets });
  } catch (e) { next(e); }
});

router.post('/assets', write, validateBody(assetSchema), async (req, res, next) => {
  try {
    const asset = await prisma.asset.create({
      data: { ...req.body, tenantId: req.user.tenantId },
      include: { unit: { select: { id: true, code: true } } },
    });
    await writeAudit(req, 'asset.create', 'Asset', asset.id, null, { name: asset.name });
    res.status(201).json({ asset });
  } catch (e) { next(e); }
});

router.patch('/assets/:id', write, validateBody(assetSchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.asset.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data: req.body,
      include: { unit: { select: { id: true, code: true } } },
    });
    res.json({ asset });
  } catch (e) { next(e); }
});

router.delete('/assets/:id', write, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    await prisma.asset.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
