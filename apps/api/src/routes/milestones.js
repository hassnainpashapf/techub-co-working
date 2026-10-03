// Phase 40 Track 8: Member Milestones API.
// Mount (coordinator, server.js additive): app.use('/api/milestones', require('./routes/milestones'));
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

// Recent milestones — community feed me dikhane ke liye (sab logged-in users).
router.get('/recent', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const { recentMilestones } = require('../lib/milestones');
    const list = await recentMilestones(req.user.tenantId, limit);
    res.json({ milestones: list });
  } catch (e) { next(e); }
});

// Manual run trigger (staff only) — abhi job enqueue karo.
router.post('/run', staffOnly, async (req, res, next) => {
  try {
    const jobs = require('../lib/jobs');
    await jobs.enqueue('milestones', { tenantId: req.user.tenantId, manual: true }, {});
    res.json({ ok: true, message: 'Milestone check queued' });
  } catch (e) { next(e); }
});

// Dashboard widget data (staff) — pichle 30 din ke counts.
router.get('/widget', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.auditLog.findMany({
      where: { ...tf, entity: 'Member', action: { startsWith: 'milestone.' }, createdAt: { gte: since } },
      select: { action: true },
    });
    const byKey = {};
    rows.forEach((r) => {
      const k = r.action.replace('milestone.', '');
      byKey[k] = (byKey[k] || 0) + 1;
    });
    res.json({ last30Days: rows.length, byKey });
  } catch (e) { next(e); }
});

module.exports = router;
