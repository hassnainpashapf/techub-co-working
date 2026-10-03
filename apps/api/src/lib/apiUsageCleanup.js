// Phase 36: ApiUsageLog retention — high-volume table, keep 30 days.
const prisma = require('./prisma');
const { registerHandler } = require('./jobs');

const RETENTION_DAYS = 30;

async function cleanupApiUsage() {
  if (!prisma.apiUsageLog) return { skipped: 'schema-not-merged' };
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const r = await prisma.apiUsageLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { deleted: r.count, retentionDays: RETENTION_DAYS };
}

try {
  registerHandler('api-usage-cleanup', async () => cleanupApiUsage());
} catch {
  // jobs lib unavailable in some contexts — safe to skip
}

module.exports = { cleanupApiUsage, RETENTION_DAYS };
