// Phase 52 Track 6: Report chart data endpoint.
// Mount (server.js — coordinator): app.use('/api/report-charts', require('./routes/report-charts'));
// POST /api/report-charts/:id {xField, yField?, type: bar|line|pie}
// → { type, xField, yField, aggregation, points, total, truncated }
// Uses lib/reportCharts.chartData over lib/reportEngine.runReport rows.
// Migration pending ho to 503 (koi 500 crash nahi).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { canViewReport } = require('../lib/reportAccess');

const router = express.Router();
router.use(authenticate, requireTenantUser);
router.use(requireRole('ceo', 'admin', 'super_admin', 'manager'));

const bodySchema = z.object({
  xField: z.string().min(1).max(120),
  yField: z.string().max(120).optional().nullable(),
  type: z.enum(['bar', 'line', 'pie']).default('bar'),
});

router.post('/:id', async (req, res, next) => {
  try {
    if (!prisma.customReport) {
      return res.status(503).json({ error: 'Report engine abhi tayyar nahi (migration pending)' });
    }
    const { xField, yField, type } = bodySchema.parse(req.body || {});
    const report = await prisma.customReport.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!report) return res.status(404).json({ error: 'Report nahi mili' });
    if (!canViewReport(req.user, report)) return res.status(403).json({ error: 'Access denied' });

    let engine, charts;
    try {
      engine = require('../lib/reportEngine');
      charts = require('../lib/reportCharts');
    } catch {
      return res.status(503).json({ error: 'Report engine abhi tayyar nahi (migration pending)' });
    }
    const result = await engine.runReport(req.user.tenantId, {
      entity: report.entity,
      columns: report.columns,
      filters: report.filters || [],
      sorts: report.sorts || [],
      groupBy: report.groupBy,
    }, { limit: 5000 });
    const chart = charts.chartData(result.rows || [], { xField, yField: yField || null, type });
    res.json({ reportId: report.id, reportName: report.name, chart });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(422).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    if (err.status === 503) return res.status(503).json({ error: err.message });
    if (err.status === 422) return res.status(422).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
