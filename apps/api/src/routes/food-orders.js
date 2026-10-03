// Phase 43 Track 2: Member Ordering — member orders + kitchen status flow.
// Mount (coordinator): app.use('/api/food-orders', require('./routes/food-orders'));
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { createNotification } = require('../lib/notify');

const router = express.Router();
router.use(authenticate, requireTenantUser);

// 503 agar schema merge na hua ho
function missingSchema(req, res, next) {
  if (typeof prisma.foodOrder === 'undefined') {
    return res.status(503).json({ error: { message: 'Food ordering schema not merged yet. Deploy pending.' } });
  }
  return next();
}

const memberOnly = (req, res, next) => {
  if (req.user.role !== 'member') {
    return res.status(403).json({ error: { message: 'Member access only.' } });
  }
  return next();
};

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist'];
const staffOnly = requireRole(...STAFF_ROLES);

const STATUSES = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'];
const NEXT = { pending: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['delivered'] };

async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

const orderItemSchema = z.object({
  menuItemId: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(50),
  price: z.number().nonnegative(),
});

const placeOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(30),
  note: z.string().max(500).optional().default(''),
  deliveryZone: z.string().max(100).optional().default(''),
});

function money(n) { return Math.round(Number(n) * 100) / 100; }

// Kitchen/staff ko new-order notification (track 3 KDS bhi isi ko import kar sakta hai).
// Track 3 integration: require('./food-orders') ke exports se notifyKitchenOrder(order, member) use karo.
async function notifyKitchenOrder(tenantId, order, memberName) {
  const itemSummary = order.items.map((i) => `${i.qty}x ${i.name}`).join(', ');
  const message = `New food order from ${memberName}: ${itemSummary}`;
  for (const role of ['manager', 'receptionist']) {
    try {
      await createNotification(null, { tenantId, role, type: 'food.order_new', message });
    } catch (e) { /* notification kabhi order fail nahi karti */ }
  }
}

// Re-price items against MenuItem (agar track 1 ka model merged hai to server-side price),
// warna client bheji price accept (guarded fallback).
async function priceItems(tenantId, items) {
  if (typeof prisma.menuItem === 'undefined') {
    return items.map((i) => ({ menuItemId: i.menuItemId || null, name: i.name, qty: i.qty, price: money(i.price) }));
  }
  const ids = [...new Set(items.map((i) => i.menuItemId).filter(Boolean))];
  const menu = ids.length
    ? await prisma.menuItem.findMany({ where: { id: { in: ids }, tenantId } })
    : [];
  const byId = Object.fromEntries(menu.map((m) => [m.id, m]));
  return items.map((i) => {
    if (i.menuItemId && byId[i.menuItemId]) {
      const m = byId[i.menuItemId];
      if (!m.isAvailable) throw Object.assign(new Error(`"${m.name}" is not available right now.`), { status: 409 });
      return { menuItemId: m.id, name: m.name, qty: i.qty, price: money(m.price) };
    }
    // free-text item (no menu link)
    return { menuItemId: null, name: i.name, qty: i.qty, price: money(i.price) };
  });
}

// POST /api/food-orders — order place (member only)
router.post('/', memberOnly, missingSchema, validateBody(placeOrderSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });

    let priced;
    try {
      priced = await priceItems(tf.tenantId, req.body.items);
    } catch (e) {
      return res.status(e.status || 422).json({ error: { message: e.message } });
    }
    const subtotal = money(priced.reduce((s, i) => s + i.qty * i.price, 0));
    if (subtotal <= 0) return res.status(422).json({ error: { message: 'Order total must be positive.' } });

    const order = await prisma.foodOrder.create({
      data: {
        tenantId: tf.tenantId,
        memberId: member.id,
        items: priced,
        subtotal,
        note: req.body.note || null,
        deliveryZone: req.body.deliveryZone || null,
      },
      include: { member: { select: { name: true } } },
    });

    notifyKitchenOrder(tf.tenantId, { items: priced }, order.member.name);
    return res.status(201).json(order);
  } catch (e) { return next(e); }
});

// GET /api/food-orders/mine — meri orders (member only)
router.get('/mine', memberOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    const orders = await prisma.foodOrder.findMany({
      where: { memberId: member.id, ...tf },
      orderBy: { orderedAt: 'desc' },
      take: 30,
    });
    return res.json({ orders });
  } catch (e) { return next(e); }
});

// GET /api/food-orders — active orders (staff)
router.get('/', staffOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status) where.status = req.query.status;
    else if (req.query.active === '1') where.status = { in: ['pending', 'preparing', 'ready'] };
    const orders = await prisma.foodOrder.findMany({
      where,
      include: { member: { select: { id: true, name: true, phone: true } } },
      orderBy: { orderedAt: 'asc' },
      take: 100,
    });
    return res.json({ orders });
  } catch (e) { return next(e); }
});

// POST /api/food-orders/:id/status — status advance (staff)
router.post('/:id/status', staffOnly, missingSchema, validateBody(z.object({ status: z.enum(STATUSES) })), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const order = await prisma.foodOrder.findFirst({ where: { id: req.params.id, ...tf } });
    if (!order) return res.status(404).json({ error: { message: 'Order not found.' } });
    const allowed = NEXT[order.status] || [];
    if (!allowed.includes(req.body.status)) {
      return res.status(422).json({ error: { message: `Cannot move ${order.status} → ${req.body.status}.` } });
    }
    const data = { status: req.body.status };
    if (req.body.status === 'ready') data.readyAt = new Date();
    if (req.body.status === 'delivered') data.deliveredAt = new Date();
    const updated = await prisma.foodOrder.update({ where: { id: order.id }, data });
    await writeAudit(req, 'food_order.status', 'FoodOrder', order.id, { from: order.status, to: req.body.status });
    return res.json(updated);
  } catch (e) { return next(e); }
});

// POST /api/food-orders/:id/cancel — member khud cancel (pending/preparing tak), ya staff
router.post('/:id/cancel', missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const order = await prisma.foodOrder.findFirst({ where: { id: req.params.id, ...tf } });
    if (!order) return res.status(404).json({ error: { message: 'Order not found.' } });

    const isStaff = STAFF_ROLES.includes(req.user.role);
    if (!isStaff) {
      if (req.user.role !== 'member') return res.status(403).json({ error: { message: 'Not allowed.' } });
      const member = await myMember(req);
      if (!member || order.memberId !== member.id) {
        return res.status(403).json({ error: { message: 'Not your order.' } });
      }
    }
    if (!['pending', 'preparing'].includes(order.status)) {
      return res.status(422).json({ error: { message: `Cannot cancel order in ${order.status} state.` } });
    }
    const updated = await prisma.foodOrder.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    await writeAudit(req, 'food_order.cancel', 'FoodOrder', order.id, {});
    return res.json(updated);
  } catch (e) { return next(e); }
});

module.exports = router;
module.exports.notifyKitchenOrder = notifyKitchenOrder;
