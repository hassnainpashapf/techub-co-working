// Phase 43 Track 9: F&B Waste & Inventory Link.
// Mount: app.use('/api/food-waste', require('./routes/food-waste')); (coordinator, additive)
//
// INVENTORY AUTO-DEDUCT NOTE (coordinator decide kare):
//   Abhi waste sirf log hota hai (cost estimate ke sath) — inventory se auto-deduct
//   nahi hota kyunki MenuItem -> raw ingredients ka mapping (BOM) schema me maujood
//   nahi hai. Agar future me BOM chahiye to:
//     1. MenuItem par `ingredients Json` jodo: [{inventoryItemId, qtyPerServing}]
//     2. Yahan POST / par per-unit waste * ingredients par InventoryItem.quantity decrement karo
//        (movement log ke sath, reorderAlerts touchRestockedAt jaisa pattern).
//   Coordinator chaahe to is track ko "log-only" rakhe — yehi is phase ka scope tha.
//
// KITCHEN PAGE INTEGRATION (coordinator):
//   apps/web/app/(app)/cafe/kitchen/page.js me "Log waste" button lagana hai jo
//   POST /api/food-waste par bheje: {date, menuItemId?, description, quantity, reason, costEstimate?}.
//   (Track 3 kitchen page own karta hai; ye note us ke liye hai.)
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

function wasteEnabled() {
  return !!(prisma && prisma.foodWaste);
}
function guard503(req, res, next) {
  if (!wasteEnabled()) return res.status(503).json({ error: 'Food waste schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'FoodWaste', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const REASONS = ['spoiled', 'overcooked', 'expired', 'other'];

const wasteSchema = z.object({
  date: z.coerce.date(),
  menuItemId: z.string().min(1).optional().nullable(),
  description: z.string().min(1).max(300),
  quantity: z.number().int().min(1).max(100000),
  reason: z.enum(REASONS).default('spoiled'),
  costEstimate: z.number().min(0).max(999999).optional().nullable(),
});

// GET / — waste logs (?from, ?to, ?reason, ?menuItemId)
router.get('/', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const where = { tenantId: tf.tenantId };
    if (req.query.reason && REASONS.includes(req.query.reason)) where.reason = req.query.reason;
    if (req.query.menuItemId) where.menuItemId = String(req.query.menuItemId);
    if (req.query.from || req.query.to) {
      where.date = {};
      if (req.query.from) where.date.gte = new Date(req.query.from);
      if (req.query.to) where.date.lte = new Date(req.query.to);
    }
    const rows = await prisma.foodWaste.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    // MenuItem name join (model merge ho to)
    let names = {};
    if (prisma.menuItem) {
      const ids = [...new Set(rows.map(r => r.menuItemId).filter(Boolean))];
      if (ids.length) {
        const items = await prisma.menuItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        names = Object.fromEntries(items.map(i => [i.id, i.name]));
      }
    }
    res.json(rows.map(r => ({ ...r, menuItemName: r.menuItemId ? (names[r.menuItemId] || null) : null })));
  } catch (e) {
    res.status(500).json({ error: 'Failed to load waste logs' });
  }
});

// POST / — log waste
router.post('/', staffOnly, validateBody(wasteSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const data = req.body; // validateBody ne zod se parse kar ke req.body me rakha
    if (data.menuItemId && prisma.menuItem) {
      const item = await prisma.menuItem.findFirst({ where: { id: data.menuItemId, tenantId: tf.tenantId }, select: { id: true } });
      if (!item) return res.status(400).json({ error: 'Menu item not found' });
    }
    const row = await prisma.foodWaste.create({
      data: {
        tenantId: tf.tenantId,
        date: data.date,
        menuItemId: data.menuItemId || null,
        description: data.description,
        quantity: data.quantity,
        reason: data.reason,
        costEstimate: data.costEstimate ?? null,
        recordedById: req.user.sub,
      },
    });
    audit(req, tf, 'food_waste.log', row.id, { description: data.description, quantity: data.quantity, reason: data.reason });
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: 'Failed to log waste' });
  }
});

// GET /stats — waste by reason + cost total (?from, ?to)
router.get('/stats', staffOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const where = { tenantId: tf.tenantId };
    if (req.query.from || req.query.to) {
      where.date = {};
      if (req.query.from) where.date.gte = new Date(req.query.from);
      if (req.query.to) where.date.lte = new Date(req.query.to);
    }
    const byReason = await prisma.foodWaste.groupBy({
      by: ['reason'],
      where,
      _sum: { quantity: true, costEstimate: true },
      _count: { _all: true },
    });
    const total = await prisma.foodWaste.aggregate({
      where,
      _sum: { quantity: true, costEstimate: true },
      _count: { _all: true },
    });
    res.json({
      byReason: byReason.map(r => ({
        reason: r.reason,
        entries: r._count._all,
        totalQuantity: r._sum.quantity || 0,
        totalCost: Number(r._sum.costEstimate || 0),
      })),
      total: {
        entries: total._count._all,
        totalQuantity: total._sum.quantity || 0,
        totalCost: Number(total._sum.costEstimate || 0),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load waste stats' });
  }
});

module.exports = router;
