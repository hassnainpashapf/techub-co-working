// Phase 52 Track 5: Pivot / crosstab views over a saved custom report.
// Mount: app.use('/api/report-pivot', require('./routes/report-pivot'));  → server.js
// Sidebar link: none — report builder extend (Track 2). Builder me "📊 Pivot view"
// toggle: row/col/value/agg select karein → POST /api/report-pivot/:id/pivot
// {rowField, colField, valueField?, agg} → {rows, cols, matrix, rowTotals, colTotals, grandTotal}
// Dependencies: Track 1 CustomReport model + lib/reportEngine.runReport(tenantId, def)
// (merge se pehle 503, koi 500 nahi).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { pivot } = require('../lib/pivot');

const router = express.Router();
router.use(authenticate, requireTenantUser);
router.use(requireRole('ceo', 'admin', 'super_admin', 'manager'));

function modelsReady(res) {
  if (!prisma.customReport) {
    res.status(503).json({ error: 'Custom reports not available yet (migration pending)' });
    return false;
  }
  return true;
}

function engineReady(res) {
  try {
    return require('../lib/reportEngine');
  } catch {
    res.status(503).json({ error: 'Report engine not available yet' });
    return null;
  }
}

const pivotSchema = z.object({
  rowField: z.string().min(1).max(120),
  colField: z.string().min(1).max(120),
  valueField: z.string().min(1).max(120).optional(),
  agg: z.enum(['sum', 'count', 'avg']).default('sum'),
});

function availableFields(report) {
  const cols = Array.isArray(report.columns) ? report.columns : [];
  const names = new Set();
  for (const c of cols) {
    if (c && c.field) names.add(String(c.field));
    if (c && c.label) names.add(String(c.label));
  }
  return [...names];
}

router.post('/:id/pivot', validateBody(pivotSchema), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const engine = engineReady(res);
    if (!engine) return;

    const tf = tenantFilter(req);
    const report = await prisma.customReport.findFirst({ where: { id: req.params.id, ...tf } });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const fields = availableFields(report);
    const { rowField, colField, valueField, agg } = req.body;
    const missing = [rowField, colField, ...(valueField ? [valueField] : [])]
      .filter((f) => !fields.includes(f));
    if (missing.length) {
      return res.status(422).json({
        error: `Unknown pivot field(s): ${missing.join(', ')}`,
        availableFields: fields,
      });
    }

    // Track 1 interface: runReport(tenantId, def) → rows | { rows, total }
    const def = {
      entity: report.entity,
      columns: report.columns,
      filters: report.filters,
      sorts: report.sorts,
      groupBy: report.groupBy,
    };
    const out = await engine.runReport(tf.tenantId, def);
    const rows = Array.isArray(out) ? out : (out && Array.isArray(out.rows) ? out.rows : []);
    if (rows.length > 10000) {
      return res.status(422).json({ error: 'Report too large to pivot (limit 10,000 rows)' });
    }

    const result = pivot(rows, { rowField, colField, valueField, agg });
    res.json({ reportId: report.id, reportName: report.name, entity: report.entity, ...result });
  } catch (err) {
    if (err && err.message && /pivot|rowField|colField|valueField|agg/.test(err.message)) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
