// Phase 32 Track 9: System health API.
const express = require('express');

const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const health = require('../lib/healthCheck');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const adminOnly = requireRole('ceo', 'admin', 'super_admin');

function scopedTenant(req) {
  // super_admin may have no tenant — fall back to global (all tenants) view.
  return (req.user && req.user.tenantId) || null;
}

// Current status: DB, queue, cache, uptime, memory, version
router.get('/status', adminOnly, async (req, res, next) => {
  try {
    res.json(await health.statusSnapshot(scopedTenant(req)));
  } catch (e) {
    next(e);
  }
});

// Last-24h metrics: job stats, email queue depth, recent failed jobs
router.get('/metrics', adminOnly, async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const where = { ...tenantFilter(req), createdAt: { gte: since } };
    const jobs = require('../lib/jobs');
    const m = jobs.jobModel();
    let jobStats = [];
    let emailQueueDepth = 0;
    let recentFailed = [];
    if (m) {
      try {
        jobStats = await m.groupBy({ by: ['status'], where, _count: true });
        emailQueueDepth = await m.count({
          where: { ...where, type: 'email', status: 'pending' },
        });
        recentFailed = await m.findMany({
          where: { ...where, status: 'failed' },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: { id: true, type: true, attempts: true, lastError: true, updatedAt: true },
        });
      } catch { /* table may not exist yet */ }
    }
    res.json({ window: '24h', jobStats, emailQueueDepth, recentFailed });
  } catch (e) {
    next(e);
  }
});

// Manual trigger: run the health check now (alerts go through normal cooldown)
router.post('/check-now', adminOnly, async (req, res, next) => {
  try {
    res.json(await health.processHealthCheck({ tenantId: scopedTenant(req) }));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
