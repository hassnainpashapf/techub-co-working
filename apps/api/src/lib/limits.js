// Phase 22: Feature flags / plan limits helper.
// checkLimit(tenantId, resource) -> { allowed, limit, used }

const prisma = require('./prisma');

const RESOURCE_MODELS = {
  users: 'user',
  members: 'member',
  units: 'unit',
};

async function getTenantPlan(tenantId) {
  if (!tenantId) return null;
  const sub = await prisma.tenantSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  return sub && sub.plan ? sub.plan : null;
}

// Returns { allowed, limit, used } for 'users' | 'members' | 'units'.
// Tenants with no subscription are treated as starter plan.
async function checkLimit(tenantId, resource) {
  const model = RESOURCE_MODELS[resource];
  if (!model) throw new Error(`Unknown resource: ${resource}`);
  const plan = await getTenantPlan(tenantId);
  const limit =
    resource === 'users' ? plan?.maxUsers ?? 5
    : resource === 'members' ? plan?.maxMembers ?? 50
    : plan?.maxUnits ?? 10;
  const used = await prisma[model].count({ where: { tenantId } });
  return { allowed: used < limit, limit, used };
}

module.exports = { checkLimit, getTenantPlan };
