// Phase 52 Track 3/10: Report Exports (CSV / XLSX / PDF).
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/report-exports', require('./routes/report-exports'));
// INTEGRATION (builder preview — track 2 ki page):
//   "Export" buttons: GET `/api/report-exports/:id/csv|xlsx|pdf` (download).
// SCHEMA DEPENDENCY: Track 1 ka `CustomReport` fragment + `lib/reportEngine.js`
// merge hote hi exports live (lazy require — merge se pehle 503, koi 500 nahi).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { toCsv, toXlsx, toPdf, slugify } = require('../lib/reportExport');

const router = express.Router();
router.use(authenticate, requireTenantUser);
router.use(requireRole('ceo', 'admin', 'super_admin', 'manager'));

const EXPORT_LIMIT = 5000;

function engine() {
  try {
    return require('../lib/reportEngine');
  } catch {
    return null;
  }
}

async function loadReport(tenantId, id) {
  if (!prisma.customReport) return { pending: true };
  const report = await prisma.customReport.findFirst({ where: { id, tenantId } });
  if (!report) return { notFound: true };
  return { report };
}

async function runRows(tenantId, report) {
  const eng = engine();
  if (!eng) return { pending: true };
  const def = {
    entity: report.entity,
    columns: report.columns,
    filters: report.filters,
    sorts: report.sorts,
    groupBy: report.groupBy,
    limit: EXPORT_LIMIT,
  };
  const run = eng.runReport || eng.run;
  if (typeof run !== 'function') return { pending: true };
  const rows = await run(tenantId, def);
  return { rows: Array.isArray(rows) ? rows.slice(0, EXPORT_LIMIT) : [] };
}

function tableOf(report, rows) {
  const cols = Array.isArray(report.columns) && report.columns.length ? report.columns : [];
  const headers = cols.map((c) => (typeof c === 'string' ? c : c.label || c.field || ''));
  const data = rows.map((r) => cols.map((c) => {
    const f = typeof c === 'string' ? c : c.field;
    return r?.[f];
  }));
  return { headers, data };
}

function filename(report, ext) {
  const d = new Date().toISOString().slice(0, 10);
  return `report-${slugify(report.name)}-${d}.${ext}`;
}

async function prepare(req, res) {
  const tf = tenantFilter(req);
  const { pending, notFound, report } = await loadReport(tf.tenantId, req.params.id);
  if (pending) { res.status(503).json({ error: 'Report engine abhi tayyar nahi (migration pending)' }); return null; }
  if (notFound) { res.status(404).json({ error: 'Report nahi mili' }); return null; }
  const r = await runRows(tf.tenantId, report);
  if (r.pending) { res.status(503).json({ error: 'Report engine abhi tayyar nahi (migration pending)' }); return null; }
  return { report, ...tableOf(report, r.rows) };
}

router.get('/:id/csv', async (req, res) => {
  try {
    const p = await prepare(req, res);
    if (!p) return;
    const csv = toCsv(p.headers, p.data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename(p.report, 'csv')}"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: 'Export fail ho gaya' });
  }
});

router.get('/:id/xlsx', async (req, res) => {
  try {
    const p = await prepare(req, res);
    if (!p) return;
    const buf = toXlsx(p.headers, p.data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename(p.report, 'xlsx')}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'Export fail ho gaya' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const p = await prepare(req, res);
    if (!p) return;
    const buf = await toPdf(p.report.name, p.headers, p.data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename(p.report, 'pdf')}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'Export fail ho gaya' });
  }
});

module.exports = router;
