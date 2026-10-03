// Phase 43 Track 10: F&B Reports & Dashboard.
// Mount: /api/cafe (coordinator). No migration — reads tracks 1-9 data (all guarded).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);
router.use(requireRole('ceo', 'admin', 'super_admin', 'manager'));

// Defensive guards — coordinator merges sibling fragments later; nothing here may 503.
const hasFoodOrder = () => !!(prisma && prisma.foodOrder);
const hasMenuItem = () => !!(prisma && prisma.menuItem);
const hasFoodWaste = () => !!(prisma && prisma.foodWaste);
const hasMealPlan = () => !!(prisma && prisma.mealPlan && prisma.memberMealPlan);

function dayStart(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
const num = (v) => (v == null ? 0 : Number(v));

// Aggregate item qty/revenue from orders' items Json.
// items: [{ menuItemId?, name, qty, price }]
function aggregateItems(orders) {
  const map = {};
  for (const o of orders) {
    const items = Array.isArray(o.items) ? o.items : [];
    for (const it of items) {
      const key = (it && (it.name || it.menuItemId || 'item')) || 'item';
      if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0 };
      map[key].qty += num(it.qty) || 1;
      map[key].revenue += (num(it.qty) || 1) * num(it.price);
    }
  }
  return Object.values(map).sort((a, b) => b.qty - a.qty);
}

// GET /stats — aaj ki sales, active orders, avg prep time, top items, waste cost, meal plan subscribers
router.get('/stats', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const today = dayStart();
    const stats = {
      modules: { orders: hasFoodOrder(), waste: hasFoodWaste(), mealPlans: hasMealPlan() },
      today: { revenue: 0, orders: 0, cancelled: 0 },
      activeOrders: 0,
      ordersByStatus: {},
      avgPrepTimeMin: null,
      topItems: [],
      wasteCostToday: 0,
      mealPlanSubscribers: 0,
    };

    if (hasFoodOrder()) {
      const orders = await prisma.foodOrder.findMany({
        where: { ...tf, orderedAt: { gte: today } },
        select: { status: true, subtotal: true, items: true, orderedAt: true, readyAt: true },
      });
      let revenue = 0, count = 0, cancelled = 0;
      let prepSum = 0, prepCount = 0;
      const byStatus = {};
      for (const o of orders) {
        byStatus[o.status] = (byStatus[o.status] || 0) + 1;
        if (o.status === 'cancelled') { cancelled++; continue; }
        count++;
        revenue += num(o.subtotal);
        if (o.readyAt && o.orderedAt) {
          prepSum += (new Date(o.readyAt) - new Date(o.orderedAt)) / 60000;
          prepCount++;
        }
      }
      stats.today = { revenue, orders: count, cancelled };
      stats.ordersByStatus = byStatus;
      stats.avgPrepTimeMin = prepCount ? Math.round(prepSum / prepCount) : null;
      stats.topItems = aggregateItems(orders).slice(0, 5);

      const active = await prisma.foodOrder.count({
        where: { ...tf, status: { in: ['pending', 'preparing', 'ready'] } },
      });
      stats.activeOrders = active;
    }

    if (hasFoodWaste()) {
      const waste = await prisma.foodWaste.findMany({
        where: { ...tf, date: { gte: today } },
        select: { costEstimate: true },
      });
      stats.wasteCostToday = waste.reduce((s, w) => s + num(w.costEstimate), 0);
    }

    if (hasMealPlan()) {
      stats.mealPlanSubscribers = await prisma.memberMealPlan.count({
        where: { ...tf, status: 'active' },
      });
    }

    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load cafe stats' });
  }
});

// GET /sales-trend?days=30 — daily F&B revenue
router.get('/sales-trend', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const days = Math.min(180, Math.max(1, parseInt(req.query.days, 10) || 30));
    const since = new Date(dayStart());
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const series = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setUTCDate(d.getUTCDate() + i);
      series.push({ date: d.toISOString().slice(0, 10), revenue: 0, orders: 0 });
    }
    if (hasFoodOrder()) {
      const orders = await prisma.foodOrder.findMany({
        where: { ...tf, orderedAt: { gte: since }, status: { not: 'cancelled' } },
        select: { subtotal: true, orderedAt: true },
      });
      for (const o of orders) {
        const key = new Date(o.orderedAt).toISOString().slice(0, 10);
        const slot = series.find((s) => s.date === key);
        if (slot) { slot.revenue += num(o.subtotal); slot.orders++; }
      }
    }
    res.json({ days, series, ordersEnabled: hasFoodOrder() });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load sales trend' });
  }
});

// GET /top-items?days=30 — sab se zyada bikne wale items
router.get('/top-items', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const days = Math.min(180, Math.max(1, parseInt(req.query.days, 10) || 30));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const since = new Date(dayStart());
    since.setUTCDate(since.getUTCDate() - (days - 1));
    let items = [];
    if (hasFoodOrder()) {
      const orders = await prisma.foodOrder.findMany({
        where: { ...tf, orderedAt: { gte: since }, status: { not: 'cancelled' } },
        select: { items: true },
      });
      items = aggregateItems(orders).slice(0, limit);
    }
    res.json({ days, items, ordersEnabled: hasFoodOrder() });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load top items' });
  }
});

module.exports = router;
