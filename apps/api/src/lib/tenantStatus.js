// Phase 35 Track 10: tenant suspension status with a short-TTL in-memory cache.
// Used by auth middleware so suspended tenants are blocked API-wide without a
// DB hit on every request. Call invalidateTenantStatus() after suspend/activate.
const prisma = require('./prisma');

const TTL_MS = 60 * 1000;
const cache = new Map(); // tenantId -> { suspended: bool, at: number }

async function getTenantStatus(tenantId) {
  if (!tenantId) return { suspended: false };
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return { suspended: hit.suspended };
  let suspended = false;
  try {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { isActive: true, suspendedAt: true },
    });
    suspended = !t || t.isActive === false || !!t.suspendedAt;
  } catch (_e) {
    // Fail-open on DB/schema hiccups (e.g. column not migrated yet) so a
    // deploy glitch never locks every tenant out. Login-time check is the
    // authoritative gate; this is defense-in-depth.
    suspended = false;
  }
  cache.set(tenantId, { suspended, at: Date.now() });
  return { suspended };
}

async function isTenantSuspended(tenantId) {
  return (await getTenantStatus(tenantId)).suspended;
}

function invalidateTenantStatus(tenantId) {
  if (tenantId) cache.delete(tenantId);
}

module.exports = { getTenantStatus, isTenantSuspended, invalidateTenantStatus };
