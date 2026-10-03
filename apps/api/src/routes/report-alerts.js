// Phase 52 Track 8: KPI Threshold Alerts — CRUD API.
// Mount (server.js — coordinator): app.use('/api/report-alerts', require('./routes/report-alerts'));
// Sidebar link nahi — reports builder extend hai (builder page me "Alerts" tab jorein).
// Migration pending ho to 503 (koi 500 crash nahi).

const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

function guard(res) {
  if (!prisma.reportAlert || !prisma.customReport) {
    res.status(503).json({ ok: false, error: 'Report alerts abhi migrate nahi huin' });
    return true;
  }
  return false;
}

const alertSchema = z.object({
  reportId: z.string().min(1),
  name: z.string().max(120).optional(),
  metricField: z.string().min(1),
  aggregate: z.enum(['sum', 'count', 'avg']).default('sum'),
  operator: z.enum(['gt', 'lt', 'eq']),
  threshold: z.number(),
  checkFrequency: z.enum(['daily', 'weekly']).default('daily'),
  isActive: z.boolean().default(true),
});

// GET /api/report-alerts — alerts list (report name ke sath).
router.get('/', requireRole(...STAFF), async (req, res) => {
  try {
    if (guard(res)) return;
    const tf = tenantFilter(req);
    const rows = await prisma.reportAlert.findMany({
      where: tf,
      include: { report: { select: { id: true, name: true, entity: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, items: rows.map((a) => ({
      id: a.id, reportId: a.reportId,
      report: a.report ? { id: a.report.id, name: a.report.name, entity: a.report.entity } : null,
      name: a.name, metricField: a.metricField, aggregate: a.aggregate,
      operator: a.operator, threshold: Number(a.threshold),
      checkFrequency: a.checkFrequency, isActive: a.isActive,
      lastRunAt: a.lastRunAt, lastTriggeredAt: a.lastTriggeredAt,
      lastValue: a.lastValue === null ? null : Number(a.lastValue),
      createdAt: a.createdAt,
    })) });
  } catch (e) {
    console.error('[report-alerts] list failed:', e.message);
    res.status(500).json({ ok: false, error: 'Alerts load nahi ho sakin' });
  }
});

// POST /api/report-alerts — naya alert.
router.post('/', requireRole(...STAFF), async (req, res) => {
  try {
    if (guard(res)) return;
    const tf = tenantFilter(req);
    const body = alertSchema.parse(req.body);
    const report = await prisma.customReport.findFirst({
      where: { id: body.reportId, ...tf }, select: { id: true },
    });
    if (!report) return res.status(404).json({ ok: false, error: 'Report nahi mili' });
    const alert = await prisma.reportAlert.create({
      data: {
        tenantId: tf.tenantId, reportId: body.reportId,
        name: body.name || null, metricField: body.metricField,
        aggregate: body.aggregate, operator: body.operator,
        threshold: body.threshold, checkFrequency: body.checkFrequency,
        isActive: body.isActive, createdBy: req.user.id,
      },
    });
    try {
      await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'report_alert.create', entity: 'ReportAlert', entityId: alert.id, newValue: { metricField: body.metricField, operator: body.operator, threshold: body.threshold } });
    } catch {}
    res.status(201).json({ ok: true, alert: { id: alert.id } });
  } catch (e) {
    if (e && e.name === 'ZodError') return res.status(422).json({ ok: false, error: 'Ghalat input', details: e.errors });
    console.error('[report-alerts] create failed:', e.message);
    res.status(500).json({ ok: false, error: 'Alert nahi ban saka' });
  }
});

// PATCH /api/report-alerts/:id — edit / on-off.
router.patch('/:id', requireRole(...STAFF), async (req, res) => {
  try {
    if (guard(res)) return;
    const tf = tenantFilter(req);
    const body = alertSchema.partial().omit({ reportId: true }).parse(req.body);
    const existing = await prisma.reportAlert.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ ok: false, error: 'Alert nahi mila' });
    if (body.reportId !== undefined) delete body.reportId;
    const updated = await prisma.reportAlert.update({ where: { id: existing.id }, data: body });
    try {
      await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'report_alert.update', entity: 'ReportAlert', entityId: updated.id, newValue: body });
    } catch {}
    res.json({ ok: true });
  } catch (e) {
    if (e && e.name === 'ZodError') return res.status(422).json({ ok: false, error: 'Ghalat input', details: e.errors });
    console.error('[report-alerts] update failed:', e.message);
    res.status(500).json({ ok: false, error: 'Alert update nahi ho saka' });
  }
});

// DELETE /api/report-alerts/:id
router.delete('/:id', requireRole(...STAFF), async (req, res) => {
  try {
    if (guard(res)) return;
    const tf = tenantFilter(req);
    const existing = await prisma.reportAlert.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ ok: false, error: 'Alert nahi mila' });
    await prisma.reportAlert.delete({ where: { id: existing.id } });
    try {
      await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'report_alert.delete', entity: 'ReportAlert', entityId: existing.id });
    } catch {}
    res.json({ ok: true });
  } catch (e) {
    console.error('[report-alerts] delete failed:', e.message);
    res.status(500).json({ ok: false, error: 'Alert delete nahi ho saka' });
  }
});

// POST /api/report-alerts/:id/check — manual on-demand check (schedule ka intezar nahi).
router.post('/:id/check', requireRole(...STAFF), async (req, res) => {
  try {
    if (guard(res)) return;
    const tf = tenantFilter(req);
    const alert = await prisma.reportAlert.findFirst({
      where: { id: req.params.id, ...tf },
      include: { report: { select: { name: true } } },
    });
    if (!alert) return res.status(404).json({ ok: false, error: 'Alert nahi mila' });
    // Sirf is alert ko check karo — force run (frequency bypass).
    const engine = (() => { try { return require('../lib/reportEngine'); } catch { return null; } })();
    if (!engine || typeof engine.runReport !== 'function') {
      return res.status(503).json({ ok: false, error: 'Report engine abhi migrate nahi hua' });
    }
    const lib = require('../lib/reportAlerts');
    const { value, rowCount } = await lib.computeMetric(engine, tf.tenantId, alert);
    if (value === null) return res.status(500).json({ ok: false, error: 'Metric compute nahi ho saki' });
    const t = Number(alert.threshold);
    const hit = alert.operator === 'gt' ? value > t : alert.operator === 'lt' ? value < t : Math.abs(value - t) < 1e-9;
    let notified = false;
    if (hit) {
      // dispatch dedupe key ke sath (aaj pehle bheja to dobara nahi).
      const today = new Date().toISOString().slice(0, 10);
      const key = `[report-alert:${alert.id}:${today}]`;
      const dup = await prisma.notification.count({ where: { tenantId: tf.tenantId, message: { startsWith: key } } }).catch(() => 1);
      if (dup === 0) {
        const label = alert.name || `${alert.report ? alert.report.name : 'Report'} · ${alert.metricField}`;
        const detail = `${label} — ${alert.aggregate || 'sum'}(${alert.metricField}) = ${Number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 })} (threshold ${t}).`;
        const fullMsg = `${key} 📊 KPI Alert: ${label}: ${detail}`;
        for (const role of ['ceo', 'admin', 'manager']) {
          await prisma.notification.create({ data: { tenantId: tf.tenantId, role, type: 'general', message: fullMsg } }).catch(() => {});
        }
        await prisma.reportAlert.update({ where: { id: alert.id }, data: { lastTriggeredAt: new Date(), lastValue: value, lastRunAt: new Date() } }).catch(() => {});
        notified = true;
      }
    } else {
      await prisma.reportAlert.update({ where: { id: alert.id }, data: { lastRunAt: new Date(), lastValue: value } }).catch(() => {});
    }
    res.json({ ok: true, value: Number(value), threshold: t, operator: alert.operator, breached: hit, notified });
  } catch (e) {
    console.error('[report-alerts] manual check failed:', e.message);
    res.status(500).json({ ok: false, error: 'Check nahi ho saka' });
  }
});

module.exports = router;
