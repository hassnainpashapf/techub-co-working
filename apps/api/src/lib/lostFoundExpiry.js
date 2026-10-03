// Phase 34 Track 9: Lost & Found expiry job — 90 din purani open items auto-expire.
const prisma = require('./prisma');

const EXPIRY_DAYS = 90;

async function expireItems(tenantId) {
  const cutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const where = { status: 'open', createdAt: { lte: cutoff } };
  if (tenantId) where.tenantId = tenantId;
  const result = await prisma.lostFoundItem.updateMany({
    where,
    data: { status: 'expired' },
  });
  return { expired: result.count };
}

async function processAllTenants() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let total = 0;
  for (const t of tenants) {
    const r = await expireItems(t.id);
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
  if (!jobs || jobs.__lostFoundExpiryRegistered) return;
  jobs.__lostFoundExpiryRegistered = true;
  jobs.registerHandler('lostfound-expiry', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return expireItems(p.tenantId);
    return processAllTenants();
  });
})();

module.exports = { expireItems, processAllTenants, EXPIRY_DAYS };
