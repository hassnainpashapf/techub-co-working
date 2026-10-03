// Phase 43 Track 6: Meal Plans (Subscriptions).
// Mount: /api/meal-plans (coordinator). Server/sidebar nahi chhua.
//
// INTEGRATION NOTES (coordinator):
// 1. BILLING: POST /subscribe ke baad member ko bill karna hai. Asal invoice
//    create karna coordinator ka kaam hai (phase 31 invoices pattern):
//    yahan sirf audit + response me `billingPending: { amount, planName }`
//    diya gaya hai. Coordinator finance/invoices route se invoice banaye.
// 2. TRACK 2 (food-orders): order place par `redeemMeal: true` flag aaye to
//    `POST /api/meal-plans/redeem { memberId }` call karo (staff/key auth)
//    taake MemberMealPlan.mealsUsed++ ho. Yahan lib export bhi hai:
//      const { redeemMeal } = require('./meal-plans');
//    (module exports both `router` and `redeemMeal` helper.)
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

function plansEnabled() {
  return !!(prisma && prisma.mealPlan && prisma.memberMealPlan);
}
function guard503(req, res, next) {
  if (!plansEnabled()) return res.status(503).json({ error: 'Meal plans schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'MealPlan', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// Logged-in user ka member record (memberId from JWT, fallback email).
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

// Expired (date ya meals khatam) subscriptions ko lazy-expire karo.
async function expireStale(tf) {
  const actives = await prisma.memberMealPlan.findMany({
    where: { ...tf, status: 'active' },
    select: { id: true, endDate: true, mealsUsed: true, mealsTotal: true },
  }).catch(() => []);
  const stale = actives.filter((s) => s.endDate < new Date() || s.mealsUsed >= s.mealsTotal);
  if (!stale.length) return;
  await prisma.memberMealPlan.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: { status: 'expired' },
  }).catch(() => {});
}

// Shared redeem logic — kitchen order (track 2) se bhi call hota hai.
async function redeemMeal(tenantId, memberId) {
  await expireStale({ tenantId });
  const sub = await prisma.memberMealPlan.findFirst({
    where: { tenantId, memberId, status: 'active' },
    include: { plan: true },
    orderBy: { endDate: 'asc' },
  });
  if (!sub) return { ok: false, error: 'No active meal plan' };
  if (sub.mealsUsed >= sub.mealsTotal) {
    await prisma.memberMealPlan.update({ where: { id: sub.id }, data: { status: 'expired' } });
    return { ok: false, error: 'Meal plan exhausted' };
  }
  const updated = await prisma.memberMealPlan.update({
    where: { id: sub.id },
    data: { mealsUsed: { increment: 1 } },
  });
  if (updated.mealsUsed >= updated.mealsTotal) {
    await prisma.memberMealPlan.update({ where: { id: sub.id }, data: { status: 'expired' } });
  }
  return { ok: true, remaining: updated.mealsTotal - updated.mealsUsed, planName: sub.plan.name };
}

const planSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().nonnegative(),
  mealsPerDay: z.number().int().min(1).max(10).default(1),
  validDays: z.number().int().min(1).max(365).default(30),
  isActive: z.boolean().default(true),
});

// ---- Member views ----
router.get('/available', async (req, res) => {
  const tf = tenantFilter(req);
  const plans = await prisma.mealPlan.findMany({
    where: { ...tf, isActive: true },
    orderBy: { price: 'asc' },
  });
  res.json({ plans });
});

router.get('/mine', async (req, res) => {
  const tf = tenantFilter(req);
  const member = await myMember(req);
  if (!member) return res.status(404).json({ error: 'Member profile not linked' });
  await expireStale(tf);
  const subs = await prisma.memberMealPlan.findMany({
    where: { ...tf, memberId: member.id },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ subscriptions: subs });
});

router.post('/subscribe', validateBody(z.object({ planId: z.string().min(1) })), async (req, res) => {
  const tf = tenantFilter(req);
  const member = await myMember(req);
  if (!member) return res.status(404).json({ error: 'Member profile not linked' });
  const plan = await prisma.mealPlan.findFirst({ where: { id: req.body.planId, ...tf, isActive: true } });
  if (!plan) return res.status(404).json({ error: 'Plan not found or inactive' });
  await expireStale(tf);
  const existing = await prisma.memberMealPlan.findFirst({
    where: { ...tf, memberId: member.id, status: 'active' },
  });
  if (existing) return res.status(409).json({ error: 'You already have an active meal plan' });

  const mealsTotal = plan.mealsPerDay * plan.validDays;
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + plan.validDays);

  const sub = await prisma.memberMealPlan.create({
    data: {
      ...tf, memberId: member.id, planId: plan.id,
      startDate, endDate, mealsTotal, status: 'active',
    },
    include: { plan: true },
  });
  audit(req, tf, 'meal_plan.subscribe', sub.id, { planId: plan.id, memberId: member.id, price: Number(plan.price) });
  // Asal invoice banao (printing.js wala INV- series pattern; invoice model guarded)
  let invoice = null;
  try {
    if (typeof prisma.invoice !== 'undefined' && Number(plan.price) > 0) {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const countForMonth = await prisma.invoice.count({
        where: { tenantId: tf.tenantId, number: { startsWith: `INV-${yyyymm}-` } },
      });
      const seq = String(countForMonth + 1).padStart(4, '0');
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 7);
      invoice = await prisma.invoice.create({
        data: {
          tenantId: tf.tenantId,
          memberId: member.id,
          number: `INV-${yyyymm}-${seq}`,
          periodStart: now,
          periodEnd: endDate,
          dueDate,
          amount: plan.price,
          status: 'unpaid',
          invoiceType: 'standard',
          notes: `Meal plan subscription — ${plan.name} (${plan.mealsPerDay}/day x ${plan.validDays} days)`,
        },
      });
    }
  } catch (e) { /* invoice fail ho to subscription fail nahi hota */ }
  res.status(201).json({
    subscription: sub,
    invoice: invoice ? { id: invoice.id, number: invoice.number, amount: Number(invoice.amount) } : null,
    billingPending: invoice ? null : { amount: Number(plan.price), planName: plan.name, currency: 'Rs' },
  });
});

// ---- Kitchen/staff: redeem one meal ----
router.post('/redeem', staffOnly, validateBody(z.object({ memberId: z.string().min(1) })), async (req, res) => {
  const tf = tenantFilter(req);
  const member = await prisma.member.findFirst({ where: { id: req.body.memberId, ...tf } });
  if (!member) return res.status(404).json({ error: 'Member not found' });
  const result = await redeemMeal(tf.tenantId, member.id);
  if (!result.ok) return res.status(422).json({ error: result.error });
  audit(req, tf, 'meal_plan.redeem', member.id, { remaining: result.remaining });
  res.json(result);
});

// ---- Staff: plans CRUD ----
router.get('/', staffOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const plans = await prisma.mealPlan.findMany({
    where: tf,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { subscriptions: true } } },
  });
  const now = new Date();
  const stats = {
    total: plans.length,
    active: plans.filter((p) => p.isActive).length,
    subscribers: plans.reduce((s, p) => s + (p._count?.subscriptions || 0), 0),
    activeSubs: await prisma.memberMealPlan.count({ where: { ...tf, status: 'active' } }),
  };
  res.json({ plans, stats });
});

router.post('/', staffOnly, validateBody(planSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const plan = await prisma.mealPlan.create({
    data: {
      ...tf,
      name: req.body.name,
      description: req.body.description || null,
      price: req.body.price,
      mealsPerDay: req.body.mealsPerDay,
      validDays: req.body.validDays,
      isActive: req.body.isActive,
    },
  });
  audit(req, tf, 'meal_plan.create', plan.id, { name: plan.name });
  res.status(201).json({ plan });
});

router.patch('/:id', staffOnly, validateBody(planSchema.partial()), async (req, res) => {
  const tf = tenantFilter(req);
  const plan = await prisma.mealPlan.findFirst({ where: { id: req.params.id, ...tf } });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const updated = await prisma.mealPlan.update({ where: { id: plan.id }, data: req.body });
  audit(req, tf, 'meal_plan.update', plan.id, req.body);
  res.json({ plan: updated });
});

router.delete('/:id', staffOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const plan = await prisma.mealPlan.findFirst({ where: { id: req.params.id, ...tf } });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const activeSubs = await prisma.memberMealPlan.count({ where: { planId: plan.id, status: 'active' } });
  if (activeSubs > 0) return res.status(409).json({ error: `Cannot delete — ${activeSubs} active subscriptions` });
  await prisma.mealPlan.delete({ where: { id: plan.id } });
  audit(req, tf, 'meal_plan.delete', plan.id, null);
  res.json({ ok: true });
});

router.get('/:id/subscribers', staffOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const plan = await prisma.mealPlan.findFirst({ where: { id: req.params.id, ...tf } });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  await expireStale(tf);
  const subs = await prisma.memberMealPlan.findMany({
    where: { ...tf, planId: plan.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const memberIds = [...new Set(subs.map((s) => s.memberId))];
  const members = await prisma.member.findMany({ where: { id: { in: memberIds }, ...tf }, select: { id: true, name: true, email: true } });
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  res.json({ subscribers: subs.map((s) => ({ ...s, member: byId[s.memberId] || null })) });
});

module.exports = router;
module.exports.redeemMeal = redeemMeal;
