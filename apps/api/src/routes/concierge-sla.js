// Phase 55 Track 7: Concierge SLA API
// COORDINATOR MOUNT: app.use('/api/concierge-sla', require('./routes/concierge-sla'));
// server.js / Sidebar.js is track me nahi chhue. Sidebar link nahi — concierge section extend hai.
// Merge se pehle (ServiceRequest model na ho) -> 503 guard, koi 500 nahi.

const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { slaStatus, scanBreaches, SLA_HOURS } = require('../lib/conciergeSla');

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager', 'reception'));

function noModel(res) {
  return res.status(503).json({ error: 'concierge_module_pending', message: 'ServiceRequest model abhi merge nahi hui.' });
}

// GET /api/concierge-sla/breached — SLA breach kar chuki active requests
router.get('/breached', async (req, res) => {
  const prisma = getPrisma();
  if (!prisma.serviceRequest) return noModel(res);
  const tf = tenantFilter(req);
  try {
    const requests = await prisma.serviceRequest.findMany({
      where: { ...tf, status: { in: ['new', 'accepted', 'in_progress'] } },
      include: {
        service: { select: { id: true, name: true, category: true } },
        member: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const breached = [];
    for (const r of requests) {
      const s = slaStatus(r);
      if (s.status === 'breached') breached.push({ ...r, sla: s });
    }
    return res.json({ breached, count: breached.length });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// GET /api/concierge-sla/status?limit=50 — sab active requests ka SLA status overview
router.get('/status', async (req, res) => {
  const prisma = getPrisma();
  if (!prisma.serviceRequest) return noModel(res);
  const tf = tenantFilter(req);
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  try {
    const requests = await prisma.serviceRequest.findMany({
      where: { ...tf, status: { in: ['new', 'accepted', 'in_progress'] } },
      include: { service: { select: { id: true, name: true, category: true } }, member: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    const rows = requests.map((r) => ({ id: r.id, title: r.title, status: r.status, priority: r.priority, member: r.member, service: r.service, createdAt: r.createdAt, sla: slaStatus(r) }));
    const summary = { onTime: 0, atRisk: 0, breached: 0 };
    for (const row of rows) {
      if (row.sla.status === 'on-time') summary.onTime++;
      else if (row.sla.status === 'at-risk') summary.atRisk++;
      else if (row.sla.status === 'breached') summary.breached++;
    }
    return res.json({ rows, summary, slaHours: SLA_HOURS });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// POST /api/concierge-sla/scan — manual breach scan + manager notifications (ceo/admin)
router.post('/scan', requireRole('ceo', 'admin', 'super_admin'), async (req, res) => {
  const prisma = getPrisma();
  if (!prisma.serviceRequest) return noModel(res);
  const tf = tenantFilter(req);
  try {
    const result = await scanBreaches(tf.tenantId);
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
});

module.exports = router;
