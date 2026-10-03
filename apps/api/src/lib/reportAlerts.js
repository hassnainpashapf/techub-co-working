// Phase 52 Track 8: KPI Threshold Alerts — detection engine.
// Report run karta hai -> metric aggregate -> threshold breach ->
// Notification (ceo/admin/manager) + optional email. Daily dedupe.
//
// Coordinator wiring (server.js — main agent karega):
//   require('./lib/reportAlerts');
//   require('./lib/reportAlerts').ensureReportAlertsScheduled();
//
// Job: 'report-alert-scan' — daily subah 7 baje har tenant ke active alerts check.
// Track 1 ka reportEngine lazily load hota hai — merge na hua ho to skip (koi crash nahi).

const prisma = require('./prisma');

const DAY = 24 * 60 * 60 * 1000;

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function opSymbol(op) {
  return op === 'gt' ? '>' : op === 'lt' ? '<' : '=';
}

// Track 1 ka engine lazily (parallel tracks — merge order safe).
function getEngine() {
  try {
    const eng = require('./reportEngine');
    if (eng && typeof eng.runReport === 'function' && prisma.customReport && prisma.reportAlert) return eng;
  } catch { /* not merged yet */ }
  return null;
}

// Ek alert ke liye metric compute karo. Returns { value, rowCount }.
async function computeMetric(engine, tenantId, alert) {
  const def = await prisma.customReport.findFirst({
    where: { id: alert.reportId, tenantId },
    select: { id: true, entity: true, columns: true, filters: true, sorts: true },
  });
  if (!def) return { value: null, rowCount: 0, reason: 'report_not_found' };
  let rows;
  try {
    rows = await engine.runReport(tenantId, def);
  } catch (e) {
    return { value: null, rowCount: 0, reason: e.message };
  }
  if (!Array.isArray(rows)) rows = [];
  const agg = (alert.aggregate || 'sum').toLowerCase();
  const field = alert.metricField;
  if (agg === 'count') return { value: rows.length, rowCount: rows.length };
  const vals = rows.map((r) => num(r && r[field])).filter((n) => Number.isFinite(n));
  if (!vals.length) return { value: 0, rowCount: rows.length };
  if (agg === 'avg') return { value: vals.reduce((a, b) => a + b, 0) / vals.length, rowCount: rows.length };
  return { value: vals.reduce((a, b) => a + b, 0), rowCount: rows.length }; // sum
}

function breached(operator, value, threshold) {
  const t = Number(threshold);
  if (operator === 'gt') return value > t;
  if (operator === 'lt') return value < t;
  return Math.abs(value - t) < 1e-9; // eq
}

function freqDue(alert) {
  if (!alert.lastRunAt) return true;
  const gap = alert.checkFrequency === 'weekly' ? 6.5 * DAY : 20 * 60 * 60 * 1000;
  return Date.now() - new Date(alert.lastRunAt).getTime() >= gap;
}

async function dispatch(tenantId, alert, reportName, value, rowCount) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `[report-alert:${alert.id}:${today}]`;
  const dup = await prisma.notification.count({
    where: { tenantId, message: { startsWith: key } },
  }).catch(() => 1);
  if (dup > 0) return { sent: false, deduped: true };

  const label = alert.name || `${reportName} · ${alert.metricField}`;
  const title = `📊 KPI Alert: ${label}`;
  const detail = `${label} — ${alert.aggregate || 'sum'}(${alert.metricField}) = ${Number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 })} ${opSymbol(alert.operator)} threshold ${Number(alert.threshold).toLocaleString('en-PK')} (${rowCount} rows).`;
  const fullMsg = `${key} ${title}: ${detail}`;
  for (const role of ['ceo', 'admin', 'manager']) {
    await prisma.notification.create({
      data: { tenantId, role, type: 'general', message: fullMsg },
    }).catch(() => {});
  }

  // Optional email — tenant ke ceo/admin ko (fail-safe).
  try {
    const { sendEmail } = require('./mailer');
    const admins = await prisma.user.findMany({
      where: { tenantId, role: { in: ['ceo', 'admin'] }, isActive: true, email: { not: null } },
      select: { email: true },
    }).catch(() => []);
    const to = [...new Set(admins.map((u) => u.email).filter(Boolean))];
    if (to.length && typeof sendEmail === 'function') {
      await sendEmail({
        tenantId,
        to,
        subject: title,
        html: `<p>${detail}</p><p>Techub report alerts ne ye auto-generate kiya hai.</p>`,
      }).catch(() => {});
    }
  } catch { /* email optional */ }

  await prisma.reportAlert.update({
    where: { id: alert.id },
    data: { lastTriggeredAt: new Date(), lastValue: value, lastRunAt: new Date() },
  }).catch(() => {});
  return { sent: true };
}

// Ek tenant ke tamam due alerts check karo.
async function checkTenantAlerts(tenantId) {
  const engine = getEngine();
  if (!engine) return { ok: false, reason: 'not_migrated' };
  const alerts = await prisma.reportAlert.findMany({
    where: { tenantId, isActive: true },
    include: { report: { select: { name: true } } },
  }).catch(() => []);
  let checked = 0, triggered = 0;
  for (const alert of alerts) {
    if (!freqDue(alert)) continue;
    checked++;
    try {
      const { value, rowCount, reason } = await computeMetric(engine, tenantId, alert);
      if (value === null) {
        await prisma.reportAlert.update({ where: { id: alert.id }, data: { lastRunAt: new Date() } }).catch(() => {});
        console.error('[report-alerts] metric failed:', alert.id, reason);
        continue;
      }
      if (breached(alert.operator, value, alert.threshold)) {
        const r = await dispatch(tenantId, alert, alert.report ? alert.report.name : 'Report', value, rowCount);
        if (r.sent) triggered++;
      } else {
        await prisma.reportAlert.update({
          where: { id: alert.id },
          data: { lastRunAt: new Date(), lastValue: value },
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[report-alerts] alert failed:', alert.id, e.message);
    }
  }
  return { ok: true, checked, triggered };
}

// Sab active tenants par (job handler se).
async function checkAlerts() {
  try {
    if (!prisma.reportAlert || !prisma.customReport) return { ok: false, reason: 'not_migrated' };
    const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
    let checked = 0, triggered = 0;
    for (const t of tenants) {
      const r = await checkTenantAlerts(t.id).catch(() => null);
      if (r && r.ok) { checked += r.checked; triggered += r.triggered; }
    }
    try {
      const jobs = getJobs();
      if (jobs) await jobs.enqueue('report-alert-scan', {}, { runAt: new Date(Date.now() + DAY) });
    } catch { /* ignore */ }
    return { ok: true, tenants: tenants.length, checked, triggered };
  } catch (e) {
    console.error('[report-alerts] checkAlerts failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Auto-register with job queue.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('report-alert-scan', checkAlerts);
    }
  } catch { /* jobs module not present */ }
})();

// Boot par ensure karo ke daily 7am run scheduled hai.
async function ensureReportAlertsScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'report-alert-scan', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const seven = new Date();
      seven.setHours(7, 0, 0, 0);
      if (seven.getTime() < Date.now()) seven.setDate(seven.getDate() + 1);
      await jobs.enqueue('report-alert-scan', {}, { runAt: seven });
    }
  } catch (e) {
    console.error('[report-alerts] ensure schedule failed:', e.message);
  }
}

module.exports = { checkAlerts, checkTenantAlerts, computeMetric, ensureReportAlertsScheduled };
