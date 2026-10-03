// Phase 45 Track 4: Weekly AI Insights — API routes.
// Mount (coordinator, server.js me — additive):
//   app.use('/api/insights', require('./routes/insights'));
// Sidebar link nahi — dashboard me "Weekly Insights" card me jure ga.
//
// GET /            — tenant ke insights (unread pehle), ?week=YYYY-MM-DD ?type= ?severity= ?unreadOnly=1
// PATCH /:id/read  — insight ko read mark karo
// DELETE /:id      — insight dismiss (delete)
// POST /generate   — abhi is tenant ke liye regenerate karo (ceo/admin/super_admin)
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

function notMigrated(res) {
  return res.status(503).json({ error: 'not_migrated', message: 'Insights migration pending' });
}

// ---- List ----
router.get('/', async (req, res, next) => {
  try {
    if (!prisma.insight) return notMigrated(res);
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.week) {
      const d = new Date(String(req.query.week));
      if (!isNaN(d)) where.week = d;
    }
    if (req.query.type) where.type = String(req.query.type);
    if (req.query.severity) where.severity = String(req.query.severity);
    if (req.query.unreadOnly === '1') where.isRead = false;
    const [items, unreadCount] = await Promise.all([
      prisma.insight.findMany({
        where,
        orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      prisma.insight.count({ where: { ...tf, isRead: false } }),
    ]);
    res.json({ items, unreadCount });
  } catch (e) {
    if (e && (e.code === 'P2022' || e.code === 'P2021')) return notMigrated(res);
    next(e);
  }
});

// ---- Mark read ----
router.patch('/:id/read', async (req, res, next) => {
  try {
    if (!prisma.insight) return notMigrated(res);
    const tf = tenantFilter(req);
    const existing = await prisma.insight.findFirst({
      where: { id: req.params.id, ...tf },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const updated = await prisma.insight.update({
      where: { id: existing.id },
      data: { isRead: true },
    });
    await writeAudit(req, { action: 'insight.read', entity: 'Insight', entityId: updated.id }).catch(() => {});
    res.json(updated);
  } catch (e) {
    if (e && (e.code === 'P2022' || e.code === 'P2021')) return notMigrated(res);
    next(e);
  }
});

// ---- Dismiss ----
router.delete('/:id', async (req, res, next) => {
  try {
    if (!prisma.insight) return notMigrated(res);
    const tf = tenantFilter(req);
    const existing = await prisma.insight.findFirst({
      where: { id: req.params.id, ...tf },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    await prisma.insight.delete({ where: { id: existing.id } });
    await writeAudit(req, { action: 'insight.dismiss', entity: 'Insight', entityId: existing.id }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    if (e && (e.code === 'P2022' || e.code === 'P2021')) return notMigrated(res);
    next(e);
  }
});

// ---- Manual regenerate ----
router.post('/generate', async (req, res, next) => {
  try {
    if (!prisma.insight) return notMigrated(res);
    const { role } = req.user || {};
    if (!['ceo', 'admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const tf = tenantFilter(req);
    const { generateWeeklyInsights } = require('../lib/insightEngine');
    const result = await generateWeeklyInsights(tf.tenantId, { polish: req.query.polish !== '0' });
    await writeAudit(req, { action: 'insight.generate', entity: 'Insight', meta: { generated: result.generated } }).catch(() => {});
    res.json(result);
  } catch (e) {
    if (e && (e.code === 'P2022' || e.code === 'P2021')) return notMigrated(res);
    next(e);
  }
});

module.exports = router;
