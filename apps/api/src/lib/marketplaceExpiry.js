// Phase 33 Track 6: Marketplace expiry job — 30 din purani active listings auto-expire.
const prisma = require('./prisma');

async function expireListings(tenantId) {
  const where = { status: 'active', expiresAt: { lte: new Date() } };
  if (tenantId) where.tenantId = tenantId;
  const result = await prisma.marketplaceListing.updateMany({
    where,
    data: { status: 'expired' },
  });
  return { expired: result.count };
}

async function processAllTenants() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let total = 0;
  for (const t of tenants) {
    const r = await expireListings(t.id);
    total += r.expired;
  }
  return { expired: total, tenants: tenants.length };
}

// Auto-register with the job queue (dunning wala idempotent pattern).
(() => {
  let jobs;
  try {
    jobs = require('./jobs');
  } catch {
    return;
  }
  if (!jobs || jobs.__marketplaceExpiryRegistered) return;
  jobs.__marketplaceExpiryRegistered = true;
  jobs.registerHandler('marketplace-expiry', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return expireListings(p.tenantId);
    return processAllTenants();
  });
})();

module.exports = { expireListings, processAllTenants };
