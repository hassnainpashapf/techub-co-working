// Phase 35 Track 7: Custom KPI Dashboards — user-defined dashboards over the widget registry.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { getWidgetList, isValidWidgetId, computeWidgets } = require('../lib/kpiWidgets');

const router = express.Router();
router.use(
  authenticate,
  requireTenantUser,
  requireRole('ceo', 'admin', 'super_admin', 'finance_officer', 'manager')
);

// Schema merge se pehle 503 guard (lost-found/backups wala pattern).
function modelGuard(req, res, next) {
  if (!prisma.kpiDashboard) {
    return res.status(503).json({
      error: { message: 'KPI Dashboard schema not merged yet — KpiDashboard model unavailable.' },
    });
  }
  return next();
}
router.use(modelGuard);

function audit(req, action, entityId) {
  writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'KpiDashboard',
    entityId: entityId || '',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// GET /api/kpi-dashboards/widgets — available widget list
router.get('/widgets', async (req, res, next) => {
  try {
    res.json({ widgets: getWidgetList() });
  } catch (e) { next(e); }
});

// GET /api/kpi-dashboards — meri dashboards
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const rows = await prisma.kpiDashboard.findMany({
      where: { ...tf, userId: req.user.sub },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, layout: true, createdAt: true, updatedAt: true },
    });
    res.json({ dashboards: rows });
  } catch (e) { next(e); }
});

const layoutSchema = z.object({
  name: z.string().min(1).max(80),
  layout: z.array(z.string().min(1)).max(12).default([]),
});

// POST /api/kpi-dashboards — nayi dashboard
router.post('/', validateBody(layoutSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { name, layout } = req.body;
    const bad = layout.filter((id) => !isValidWidgetId(id));
    if (bad.length) {
      return res.status(400).json({ error: { message: `Unknown widgets: ${bad.join(', ')}` } });
    }
    const row = await prisma.kpiDashboard.create({
      data: { ...tf, userId: req.user.sub, name, layout },
      select: { id: true, name: true, layout: true, createdAt: true, updatedAt: true },
    });
    audit(req, 'kpi_dashboard.create', row.id);
    res.status(201).json({ dashboard: row });
  } catch (e) { next(e); }
});

async function ownDashboard(req) {
  const tf = tenantFilter(req);
  return prisma.kpiDashboard.findFirst({
    where: { ...tf, id: req.params.id, userId: req.user.sub },
  });
}

// GET /api/kpi-dashboards/:id/data — widgets ka live computed data
router.get('/:id/data', async (req, res, next) => {
  try {
    const dash = await ownDashboard(req);
    if (!dash) return res.status(404).json({ error: { message: 'Dashboard not found.' } });
    const ids = Array.isArray(dash.layout) ? dash.layout : [];
    const widgets = await computeWidgets(req.user.tenantId, ids);
    res.json({
      dashboard: { id: dash.id, name: dash.name, layout: ids },
      widgets,
    });
  } catch (e) { next(e); }
});

// PATCH /api/kpi-dashboards/:id — rename / layout update
router.patch('/:id', validateBody(layoutSchema.partial()), async (req, res, next) => {
  try {
    const dash = await ownDashboard(req);
    if (!dash) return res.status(404).json({ error: { message: 'Dashboard not found.' } });
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.layout !== undefined) {
      const bad = req.body.layout.filter((id) => !isValidWidgetId(id));
      if (bad.length) {
        return res.status(400).json({ error: { message: `Unknown widgets: ${bad.join(', ')}` } });
      }
      data.layout = req.body.layout;
    }
    const updated = await prisma.kpiDashboard.update({
      where: { id: dash.id },
      data,
      select: { id: true, name: true, layout: true, createdAt: true, updatedAt: true },
    });
    audit(req, 'kpi_dashboard.update', dash.id);
    res.json({ dashboard: updated });
  } catch (e) { next(e); }
});

// DELETE /api/kpi-dashboards/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const dash = await ownDashboard(req);
    if (!dash) return res.status(404).json({ error: { message: 'Dashboard not found.' } });
    await prisma.kpiDashboard.delete({ where: { id: dash.id } });
    audit(req, 'kpi_dashboard.delete', dash.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
