// Phase 54 Track 2: Member Health Score — API routes.
// NOTE: `/api/health` pehle se Phase 32 (system health) ka hai — is liye
// is route ka mount `/api/member-health` hai (conflict avoid).
// Mount (coordinator, server.js additive):
//   app.use('/api/member-health', require('./routes/member-health'));
// Job wiring (coordinator, server.js additive):
//   require('./lib/healthScore').ensureHealthScheduled();
// Sidebar link nahi — success/onboarding section extend hai (frontend track ki taraf se).

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { computeHealth, recomputeTenant } = require('../lib/healthScore');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole(['ceo', 'admin', 'super_admin', 'manager']));

function healthEnabled() {
  return !!(prisma && prisma.memberHealth);
}
function guard503(req, res, next) {
  if (!healthEnabled()) return res.status(503).json({ error: 'Health schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'MemberHealth', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// GET /api/member-health — member scores (paginated, sort, filter)
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const sort = req.query.sort === 'asc' ? 'asc' : 'desc';
    const where = { ...tf };
    if (req.query.status) where.member = { status: req.query.status };

    const [total, rows] = await Promise.all([
      prisma.memberHealth.count({ where }),
      prisma.memberHealth.findMany({
        where,
        include: { member: { select: { id: true, name: true, email: true, status: true } } },
        orderBy: { score: sort },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    res.json({ items: rows, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: 'Health scores load failed' });
  }
});

// GET /api/member-health/at-risk — score < 40 wale active members
router.get('/at-risk', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const threshold = Math.max(0, Math.min(100, parseInt(req.query.threshold || '40', 10)));
    const rows = await prisma.memberHealth.findMany({
      where: { ...tf, score: { lt: threshold }, member: { status: 'active' } },
      include: { member: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: { score: 'asc' },
      take: 100,
    });
    res.json({ threshold, count: rows.length, items: rows });
  } catch (e) {
    res.status(500).json({ error: 'At-risk list failed' });
  }
});

// GET /api/member-health/member/:memberId — ek member ka score detail
router.get('/member/:memberId', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const row = await prisma.memberHealth.findFirst({
      where: { ...tf, memberId: req.params.memberId },
      include: { member: { select: { id: true, name: true, email: true, status: true } } },
    });
    if (!row) return res.status(404).json({ error: 'Health record not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: 'Health detail failed' });
  }
});

// POST /api/member-health/recompute — { memberId? } — ek ya sab active members ka recompute
router.post('/recompute', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (req.body && req.body.memberId) {
      const result = await computeHealth(tf.tenantId, req.body.memberId);
      if (!result) return res.status(404).json({ error: 'Member not found' });
      audit(req, tf, 'health.recomputed', req.body.memberId, { score: result.score });
      return res.json(result);
    }
    const result = await recomputeTenant(tf.tenantId);
    audit(req, tf, 'health.recomputed_all', tf.tenantId, result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Recompute failed' });
  }
});

module.exports = router;
