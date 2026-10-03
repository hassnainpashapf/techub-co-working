// Phase 43 Track 3: Kitchen Display System — order queue, start/ready actions.
// Mount (coordinator): app.use('/api/kitchen', require('./routes/kitchen'));
// NOTE: FoodOrder model Track 2 (Member Ordering) ka hai — merge se pehle 503 guard.
// Track 2 ki file food-orders.js ko touch nahi kiya (parallel safety).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { createNotification } = require('../lib/notify');
const { requireCafeAccess } = require('./cafe-staff');

const router = express.Router();
router.use(authenticate, requireTenantUser);

// Kitchen staff roles — ceo/admin/super_admin/manager/ops + cafe staff (Phase 43 Track 8)
const KITCHEN_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'ops'];
const kitchenOnly = requireRole(...KITCHEN_ROLES);
const kitchenAccess = [kitchenOnly, requireCafeAccess];

const ACTIVE = ['pending', 'preparing'];

function missingSchema(req, res, next) {
  if (typeof prisma.foodOrder === 'undefined') {
    return res.status(503).json({ error: { message: 'Food orders schema not merged yet. Deploy pending.' } });
  }
  next();
}

function elapsedMin(orderedAt) {
  return Math.max(0, Math.floor((Date.now() - new Date(orderedAt).getTime()) / 60000));
}

function shapeOrder(o) {
  return {
    id: o.id,
    status: o.status,
    items: o.items || [],
    subtotal: o.subtotal,
    deliveryZone: o.deliveryZone || null,
    note: o.note || '',
    paymentStatus: o.paymentStatus || 'unpaid',
    orderedAt: o.orderedAt,
    elapsedMin: elapsedMin(o.orderedAt),
    member: o.member ? { id: o.member.id, name: o.member.name, phone: o.member.phone } : null,
  };
}

// GET /api/kitchen/queue — pending + preparing orders, elapsed time ke sath
router.get('/queue', ...kitchenAccess, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const orders = await prisma.foodOrder.findMany({
      where: { ...tf, status: { in: ACTIVE } },
      include: { member: { select: { id: true, name: true, phone: true, user: { select: { id: true } } } } },
      orderBy: { orderedAt: 'asc' },
    });
    const counts = {
      pending: orders.filter((o) => o.status === 'pending').length,
      preparing: orders.filter((o) => o.status === 'preparing').length,
    };
    res.json({ orders: orders.map(shapeOrder), counts });
  } catch (e) { next(e); }
});

// POST /api/kitchen/:id/start — pending → preparing
router.post('/:id/start', ...kitchenAccess, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const order = await prisma.foodOrder.findFirst({ where: { id: req.params.id, ...tf } });
    if (!order) return res.status(404).json({ error: { message: 'Order not found.' } });
    if (order.status !== 'pending') {
      return res.status(409).json({ error: { message: `Order is ${order.status}, cannot start.` } });
    }
    const updated = await prisma.foodOrder.update({
      where: { id: order.id },
      data: { status: 'preparing' },
      include: { member: { select: { id: true, name: true, phone: true } } },
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'kitchen.start', entity: 'FoodOrder', entityId: order.id, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ ok: true, order: shapeOrder(updated) });
  } catch (e) { next(e); }
});

// POST /api/kitchen/:id/ready — preparing → ready + member ko notification
router.post('/:id/ready', ...kitchenAccess, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const order = await prisma.foodOrder.findFirst({
      where: { id: req.params.id, ...tf },
      include: { member: { select: { id: true, name: true, phone: true, user: { select: { id: true } } } } },
    });
    if (!order) return res.status(404).json({ error: { message: 'Order not found.' } });
    if (order.status !== 'preparing') {
      return res.status(409).json({ error: { message: `Order is ${order.status}, cannot mark ready.` } });
    }
    const updated = await prisma.foodOrder.update({
      where: { id: order.id },
      data: { status: 'ready', readyAt: new Date() },
      include: { member: { select: { id: true, name: true, phone: true } } },
    });
    // Member ko notify karo — fail-safe, order update nahi rokta
    try {
      const userId = order.member && order.member.user ? order.member.user.id : null;
      await createNotification(prisma, {
        tenantId: tf.tenantId,
        userId,
        type: 'food_order.ready',
        message: `Aapka cafe order tayyar hai! Order #${order.id.slice(-6).toUpperCase()} pick kar lein.`,
      });
    } catch { /* notification fail ho to ignore */ }
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'kitchen.ready', entity: 'FoodOrder', entityId: order.id, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ ok: true, order: shapeOrder(updated) });
  } catch (e) { next(e); }
});

module.exports = router;
