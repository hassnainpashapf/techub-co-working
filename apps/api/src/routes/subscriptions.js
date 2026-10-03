// Phase 22: SaaS subscriptions & platform plans.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { checkLimit } = require('../lib/limits');

const router = express.Router();

const DEFAULT_PLANS = [
  {
    name: 'Starter',
    slug: 'starter',
    priceMonthly: 4999,
    maxUsers: 5,
    maxMembers: 50,
    maxUnits: 10,
    features: ['Core dashboard', 'Members & billing', 'Bookings', 'Email notifications'],
  },
  {
    name: 'Growth',
    slug: 'growth',
    priceMonthly: 14999,
    maxUsers: 15,
    maxMembers: 250,
    maxUnits: 40,
    features: ['Everything in Starter', 'Webhooks', 'Custom branding', 'Refunds', 'Ride sharing'],
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    priceMonthly: 39999,
    maxUsers: 100,
    maxMembers: 2000,
    maxUnits: 200,
    features: ['Everything in Growth', 'Priority support', 'Audit exports', 'Custom limits'],
  },
];

// Auto-seed default platform plans if table is empty
async function ensurePlans() {
  const count = await prisma.platformPlan.count();
  if (count > 0) return;
  await prisma.platformPlan.createMany({ data: DEFAULT_PLANS });
}

// Auto-create a starter subscription for a tenant with none
async function ensureSubscription(tenantId) {
  await ensurePlans();
  let sub = await prisma.tenantSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  if (!sub) {
    const starter = await prisma.platformPlan.findUnique({ where: { slug: 'starter' } });
    const now = new Date();
    sub = await prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: starter.id,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      include: { plan: true },
    });
  }
  return sub;
}

// Public: list platform plans
router.get('/plans', async (req, res, next) => {
  try {
    await ensurePlans();
    const plans = await prisma.platformPlan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
    res.json({ plans });
  } catch (e) { next(e); }
});

router.use(authenticate, requireTenantUser);

// Tenant's current subscription (auto-create on starter if none)
router.get('/current', async (req, res, next) => {
  try {
    const sub = await ensureSubscription(req.user.tenantId);
    res.json({ subscription: sub });
  } catch (e) { next(e); }
});

// Change plan (ceo/admin only)
const changeSchema = z.object({ planSlug: z.string().min(1) });

router.put('/change', requireRole('ceo', 'admin', 'super_admin'), validateBody(changeSchema), async (req, res, next) => {
  try {
    await ensurePlans();
    const plan = await prisma.platformPlan.findUnique({ where: { slug: req.body.planSlug } });
    if (!plan || !plan.isActive) {
      return res.status(404).json({ error: { message: 'Plan not found.' } });
    }
    const old = await ensureSubscription(req.user.tenantId);
    const now = new Date();
    const sub = await prisma.tenantSubscription.update({
      where: { tenantId: req.user.tenantId },
      data: {
        planId: plan.id,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      include: { plan: true },
    });
    await writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'subscription.change_plan',
      entity: 'TenantSubscription',
      entityId: sub.id,
      oldValue: { plan: old.plan.slug },
      newValue: { plan: plan.slug },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ subscription: sub });
  } catch (e) { next(e); }
});

// Usage vs limits
router.get('/usage', async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const [users, members, units] = await Promise.all([
      checkLimit(tenantId, 'users'),
      checkLimit(tenantId, 'members'),
      checkLimit(tenantId, 'units'),
    ]);
    res.json({ usage: { users, members, units } });
  } catch (e) { next(e); }
});

module.exports = router;
