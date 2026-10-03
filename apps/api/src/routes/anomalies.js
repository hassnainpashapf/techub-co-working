// Phase 45 Track 5: Anomaly Alerts — history API.
// Mount (server.js — coordinator): app.use('/api/anomalies', require('./routes/anomalies'));
// Sidebar link nahi — insights/alerts extend hai (dashboard ya alerts page me jorein).
// Data source: Notification rows jinke message me anomaly key prefix hai — koi migration nahi.

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);

// GET /api/anomalies — pichhle 30 din ke anomaly alerts (naye pehle).
// Dedupe key message prefix me hoti hai: [anomaly:<type>:<yyyy-mm-dd>]
router.get('/', requireRole(['ceo', 'admin', 'super_admin', 'manager']), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.notification.findMany({
      where: {
        ...tf,
        role: 'ceo', // har alert 3 roles ko gaya — ek copy hi list karo
        createdAt: { gte: since },
        message: { startsWith: '[anomaly:' },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, message: true, isRead: true, createdAt: true },
    });
    const items = rows.map((r) => {
      const m = r.message.match(/^\[anomaly:([a-z_]+):(\d{4}-\d{2}-\d{2})\]\s*(.*)$/);
      return {
        id: r.id,
        type: m ? m[1] : 'unknown',
        date: m ? m[2] : null,
        title: m ? m[3].split(':')[0] : r.message,
        detail: m ? m[3] : r.message,
        isRead: r.isRead,
        createdAt: r.createdAt,
      };
    });
    res.json({ ok: true, items, count: items.length });
  } catch (e) {
    console.error('[anomalies] list failed:', e.message);
    res.status(500).json({ ok: false, error: 'Failed to load anomaly history' });
  }
});

// GET /api/anomalies/latest — dashboard widget ke liye aaj/pichhle 7 din ka summary
router.get('/latest', requireRole(['ceo', 'admin', 'super_admin', 'manager']), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const count = await prisma.notification.count({
      where: { ...tf, role: 'ceo', createdAt: { gte: since }, message: { startsWith: '[anomaly:' } },
    });
    const unread = await prisma.notification.count({
      where: { ...tf, role: 'ceo', isRead: false, createdAt: { gte: since }, message: { startsWith: '[anomaly:' } },
    });
    res.json({ ok: true, last7Days: count, unread });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to load anomaly summary' });
  }
});

// POST /api/anomalies/scan — manual trigger (testing / on-demand)
router.post('/scan', requireRole(['ceo', 'admin', 'super_admin']), async (req, res) => {
  try {
    const { detectForTenant } = require('../lib/anomalyDetector');
    const tf = tenantFilter(req);
    const result = await detectForTenant(tf.tenantId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[anomalies] manual scan failed:', e.message);
    res.status(500).json({ ok: false, error: 'Scan failed' });
  }
});

module.exports = router;
