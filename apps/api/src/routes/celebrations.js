// Phase 40 Track 1: Birthday & Anniversary automation — API.
// Mount: app.use('/api/celebrations', require('./routes/celebrations')); (coordinator)
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { schemaReady, processTenantCelebrations } = require('../lib/celebrations');

const router = express.Router();

router.use(authenticate, requireTenantUser);
const staffOnly = requireRole('ceo', 'admin', 'super_admin', 'manager');

function guard503(res) {
  if (!schemaReady()) {
    res.status(503).json({ error: 'Celebrations not available yet (migration pending)' });
    return false;
  }
  return true;
}

function mdOf(d) {
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// GET /upcoming?days=30 — aanay wali birthdays + anniversaries
router.get('/upcoming', staffOnly, async (req, res, next) => {
  try {
    if (!guard503(res)) return;
    const tf = tenantFilter(req);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const now = new Date();

    const members = await prisma.member.findMany({
      where: { tenantId: tf.tenantId, status: 'active' },
      select: { id: true, name: true, dateOfBirth: true, createdAt: true },
    });

    const items = [];
    for (let d = 0; d <= days; d++) {
      const target = new Date(now);
      target.setDate(target.getDate() + d);
      const tmd = mdOf(target);
      for (const m of members) {
        if (m.dateOfBirth && mdOf(m.dateOfBirth) === tmd) {
          items.push({ kind: 'birthday', memberId: m.id, memberName: m.name, date: target.toISOString().slice(0, 10), daysAway: d });
        }
        const years = target.getFullYear() - new Date(m.createdAt).getFullYear();
        if (years >= 1 && mdOf(m.createdAt) === tmd) {
          items.push({ kind: 'anniversary', memberId: m.id, memberName: m.name, years, date: target.toISOString().slice(0, 10), daysAway: d });
        }
      }
    }
    items.sort((a, b) => a.daysAway - b.daysAway);
    res.json({ days, count: items.length, items });
  } catch (err) {
    next(err);
  }
});

// GET /log — haal ki bheji gayi celebrations
router.get('/log', staffOnly, async (req, res, next) => {
  try {
    if (!guard503(res)) return;
    const tf = tenantFilter(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const log = await prisma.celebrationLog.findMany({
      where: { tenantId: tf.tenantId },
      include: { member: { select: { name: true } } },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
    res.json({ count: log.length, log });
  } catch (err) {
    next(err);
  }
});

// POST /trigger — manual run (aaj ke celebrations abhi bhejo)
router.post('/trigger', staffOnly, async (req, res, next) => {
  try {
    if (!guard503(res)) return;
    const tf = tenantFilter(req);
    const result = await processTenantCelebrations(tf.tenantId, { dryRun: !!req.body.dryRun });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'celebrations.trigger', ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
