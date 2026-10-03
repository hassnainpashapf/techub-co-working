// Phase 28 Track 1: Job queue management API.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { jobModel } = require('../lib/jobs');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const ADMIN_ROLES = ['ceo', 'admin', 'super_admin'];
const adminOnly = requireRole(...ADMIN_ROLES);

function noModel(res) {
  return res.status(503).json({ error: { message: 'Job queue not available yet (schema merge pending).' } });
}

// List jobs
router.get('/', adminOnly, async (req, res, next) => {
  try {
    const m = jobModel();
    if (!m) return noModel(res);
    const { status } = req.query;
    const where = { ...tenantFilter(req) };
    if (status) where.status = status;
    const jobs = await m.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    const counts = await m.groupBy({ by: ['status'], where: { ...tenantFilter(req) }, _count: true });
    res.json({ jobs, counts });
  } catch (e) { next(e); }
});

// Retry a failed job
router.post('/:id/retry', adminOnly, async (req, res, next) => {
  try {
    const m = jobModel();
    if (!m) return noModel(res);
    const existing = await m.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: { message: 'Job not found' } });
    const job = await m.update({
      where: { id: req.params.id },
      data: { status: 'pending', attempts: 0, lastError: null, runAt: new Date() },
    });
    await writeAudit(req, 'job.retry', 'Job', job.id, null, { type: job.type });
    res.json({ job });
  } catch (e) { next(e); }
});

// Delete a job
router.delete('/:id', adminOnly, async (req, res, next) => {
  try {
    const m = jobModel();
    if (!m) return noModel(res);
    const existing = await m.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: { message: 'Job not found' } });
    await m.delete({ where: { id: req.params.id } });
    await writeAudit(req, 'job.delete', 'Job', req.params.id, { type: existing.type }, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
