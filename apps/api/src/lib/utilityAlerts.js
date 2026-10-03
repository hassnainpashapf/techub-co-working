// Phase 51 Track 6/10: Abnormal Consumption Alerts — utility meter anomaly detection.
//
// Coordinator wiring (server.js — main agent/coordinator karega):
//   require('./lib/utilityAlerts'); // auto-register handler
//   require('./lib/utilityAlerts').ensureUtilityAlertsScheduled();
//
// Hook — nayi reading create ke baad (coordinator routes/meter-readings.js POST handler me):
//   try { require('../lib/utilityAlerts').maybeCheckReading({ tenantId, meterId }).catch(() => {}); } catch {}
//
// Alerts (dedupe per meter per week):
//   1. high_consumption — nayi consumption > 2x meter ka 3-month avg (possible leak/fault)
//   2. dead_meter       — 30 din me zero consumption (dead meter?)
// Alert -> Notification (ceo/admin/manager/ops) + optional email. Dedupe: ek meter+type per week.

const prisma = require('./prisma');

const DAY = 24 * 60 * 60 * 1000;

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

function weekKey(d = new Date()) {
  // ISO week: YYYY-Www
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((x - firstThu) / (7 * DAY));
  return `${x.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function num(v) { return Number(v || 0); }

function fmtUnit(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'electricity') return 'kWh';
  if (t === 'water') return 'L';
  if (t === 'gas') return 'm³';
  return 'units';
}

// Ek meter ke liye consumption history: readings se consecutive diffs.
async function consumptionSeries(tenantId, meterId, sinceDays = 95) {
  const since = new Date(Date.now() - sinceDays * DAY);
  const readings = await prisma.meterReading.findMany({
    where: { tenantId, meterId, readAt: { gte: since } },
    orderBy: { readAt: 'asc' },
    select: { reading: true, readAt: true },
    take: 200,
  });
  const diffs = [];
  for (let i = 1; i < readings.length; i++) {
    const d = num(readings[i].reading) - num(readings[i - 1].reading);
    if (d >= 0) diffs.push({ consumption: d, at: readings[i].readAt });
  }
  return { readings, diffs };
}

async function sendAlert(tenantId, alert) {
  const dup = await prisma.notification.count({
    where: { tenantId, message: { startsWith: alert.key } },
  }).catch(() => 1);
  if (dup > 0) return false;

  const fullMsg = `${alert.key} ${alert.title}: ${alert.detail}`;
  for (const role of ['ceo', 'admin', 'manager', 'ops']) {
    await prisma.notification.create({
      data: { tenantId, role, type: 'general', message: fullMsg },
    }).catch(() => {});
  }

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
        subject: `⚠️ ${alert.title} — utility alert`,
        html: `<p>${alert.detail}</p><p>Techub utility alert detector ne ye alert auto-generate kiya hai.</p>`,
      }).catch(() => {});
    }
  } catch { /* email optional */ }

  return true;
}

// Ek meter ka full check. Returns: bheje gaye alerts.
async function checkMeter(tenantId, meter) {
  if (!prisma.meterReading) return [];
  const week = weekKey();
  const key = (type) => `[utility-alert:${type}:${meter.id}:${week}]`;
  const unit = fmtUnit(meter.type);
  const alerts = [];

  try {
    const { diffs } = await consumptionSeries(tenantId, meter.id);

    // 1) High consumption — nayi reading > 2x 3-month avg.
    if (diffs.length >= 2) {
      const recent = diffs[diffs.length - 1];
      const baseline = diffs.slice(0, -1); // aakhri ko baseline se bahar rakho
      if (baseline.length >= 1) {
        const avg = baseline.reduce((s, d) => s + d.consumption, 0) / baseline.length;
        if (avg > 0 && recent.consumption > 2 * avg) {
          alerts.push({
            key: key('high_consumption'),
            severity: recent.consumption > 4 * avg ? 'critical' : 'warning',
            title: `Abnormal consumption — ${meter.name}`,
            detail: `${meter.name} (${meter.type}) ki aakhri consumption ${recent.consumption.toFixed(1)} ${unit} hai — 3-month avg ${avg.toFixed(1)} ${unit} ka ${(recent.consumption / avg).toFixed(1)}x. Possible leak ya fault — check karein.`,
          });
        }
      }
    }

    // 2) Dead meter — 30 din me zero consumption (lekin readings aa rahi hain).
    const last30 = diffs.filter((d) => Date.now() - new Date(d.at).getTime() <= 30 * DAY);
    if (last30.length >= 1 && last30.every((d) => d.consumption === 0)) {
      alerts.push({
        key: key('dead_meter'),
        severity: 'info',
        title: `Possible dead meter — ${meter.name}`,
        detail: `${meter.name} (${meter.type}) me pichhle 30 din me zero consumption record hui (${last30.length} readings). Meter kharab ya disconnect ho sakta hai.`,
      });
    }
  } catch (e) { console.error('[utility-alert] checkMeter failed:', e.message); }

  const sent = [];
  for (const a of alerts) {
    const ok = await sendAlert(tenantId, a).catch(() => false);
    if (ok) sent.push({ key: a.key, severity: a.severity, title: a.title });
  }
  return sent;
}

// Reading create ke foran baad — sirf is meter ka check (halka, fast).
async function maybeCheckReading({ tenantId, meterId }) {
  try {
    if (!prisma.utilityMeter || !prisma.meterReading) return { skipped: 'not_migrated' };
    const meter = await prisma.utilityMeter.findFirst({
      where: { tenantId, id: meterId, isActive: true },
      select: { id: true, name: true, type: true },
    });
    if (!meter) return { skipped: 'meter_not_found' };
    const alerts = await checkMeter(tenantId, meter);
    return { ok: true, alerts };
  } catch (e) {
    console.error('[utility-alert] maybeCheckReading failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Daily full scan — sab active tenants ke sab active meters.
async function scanAllTenants() {
  try {
    if (!prisma.utilityMeter || !prisma.meterReading) return { ok: false, reason: 'not_migrated' };
    const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } }).catch(() => []);
    let total = 0;
    for (const t of tenants) {
      const meters = await prisma.utilityMeter.findMany({
        where: { tenantId: t.id, isActive: true },
        select: { id: true, name: true, type: true },
      }).catch(() => []);
      for (const m of meters) {
        const alerts = await checkMeter(t.id, m).catch(() => []);
        total += alerts.length;
      }
    }
    // Khud ko kal subah 8 baje dobara schedule karo.
    try {
      const jobs = getJobs();
      if (jobs) {
        const next = new Date();
        next.setHours(8, 0, 0, 0);
        if (next.getTime() <= Date.now()) next.setTime(next.getTime() + DAY);
        await jobs.enqueue('utility-alert-scan', {}, { runAt: next });
      }
    } catch { /* ignore */ }
    return { ok: true, tenants: tenants.length, alerts: total };
  } catch (e) {
    console.error('[utility-alert] scanAllTenants failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('utility-alert-scan', scanAllTenants);
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

// Boot par ensure karo ke daily scan scheduled hai.
async function ensureUtilityAlertsScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'utility-alert-scan', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const next = new Date();
      next.setHours(8, 0, 0, 0);
      if (next.getTime() <= Date.now()) next.setTime(next.getTime() + DAY);
      await jobs.enqueue('utility-alert-scan', {}, { runAt: next });
    }
  } catch (e) {
    console.error('[utility-alert] ensure schedule failed:', e.message);
  }
}

module.exports = { checkMeter, maybeCheckReading, scanAllTenants, ensureUtilityAlertsScheduled };
