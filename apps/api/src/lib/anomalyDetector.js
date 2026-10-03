// Phase 45 Track 5: Anomaly Alerts — daily anomaly detection engine.
// Coordinator wiring (server.js — main agent karega):
//   app.use('/api/anomalies', require('./routes/anomalies'));
//   require('./lib/anomalyDetector'); // auto-register handler
//   require('./lib/anomalyDetector').ensureAnomalyScheduled();
//
// Job: roz subah 8 baje har tenant par 4 detectors chalte hain:
//   1. expense_spike  — aaj ka kharcha > 2x pichhle 7 din ka daily avg
//   2. revenue_dip    — aaj ki payment < 70% pichhle 7 din ke daily avg se
//   3. cancel_spike   — aaj ki booking cancellations >= 2x 7-day daily avg
//   4. failed_payments — pichhle 24h ke failed online payments >= 2x 7-day daily avg
// Method: simple ratio (explainable — har alert me asal numbers hote hain).
// Dedupe: ek hi anomaly key ek din me dobara alert nahi bhejti.

const prisma = require('./prisma');

const DAY = 24 * 60 * 60 * 1000;

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function num(v) {
  return Number(v || 0);
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-PK');
}

// Ek tenant ke liye tamam detectors chalao. Returns: naye alerts ki list.
async function detectForTenant(tenantId) {
  const alerts = [];
  const today = startOfDay().toISOString().slice(0, 10);

  const push = (key, severity, title, detail) =>
    alerts.push({ key: `[anomaly:${key}:${today}]`, severity, title, detail });

  // 1) Expense spike — aaj ka kharcha > 2x 7-day daily avg (sirf approved/pending expenses)
  try {
    if (prisma.expense) {
      const since = new Date(startOfDay().getTime() - 8 * DAY);
      const rows = await prisma.expense.findMany({
        where: { tenantId, date: { gte: since }, status: { in: ['approved', 'pending'] } },
        select: { amount: true, date: true },
      });
      const { avgSum } = await (async () => {
        const byDay = {};
        for (const r of rows) {
          const k = startOfDay(new Date(r.date)).toISOString().slice(0, 10);
          if (k === today) continue; // aaj ko baseline se bahar rakho
          byDay[k] = (byDay[k] || 0) + num(r.amount);
        }
        const vals = Object.values(byDay);
        return { avgSum: vals.length ? vals.reduce((a, b) => a + b, 0) / 7 : 0 };
      })();
      const todayTotal = rows
        .filter((r) => startOfDay(new Date(r.date)).toISOString().slice(0, 10) === today)
        .reduce((a, r) => a + num(r.amount), 0);
      if (avgSum > 0 && todayTotal > 2 * avgSum) {
        push('expense_spike', 'warning', 'Expense spike',
          `Aaj ka kharcha Rs ${fmt(todayTotal)} hai — pichhle 7 din ke daily average Rs ${fmt(avgSum)} ka ${(todayTotal / avgSum).toFixed(1)}x.`);
      }
    }
  } catch (e) { console.error('[anomaly] expense_spike failed:', e.message); }

  // 2) Revenue dip — aaj ki payments < 70% of 7-day daily avg
  try {
    if (prisma.payment) {
      const since = new Date(startOfDay().getTime() - 8 * DAY);
      const rows = await prisma.payment.findMany({
        where: { tenantId, paidAt: { gte: since } },
        select: { amount: true, paidAt: true },
      });
      const byDay = {};
      for (const r of rows) {
        const k = startOfDay(new Date(r.paidAt)).toISOString().slice(0, 10);
        if (k === today) continue;
        byDay[k] = (byDay[k] || 0) + num(r.amount);
      }
      const vals = Object.values(byDay);
      const avgSum = vals.length ? vals.reduce((a, b) => a + b, 0) / 7 : 0;
      const todayTotal = rows
        .filter((r) => startOfDay(new Date(r.paidAt)).toISOString().slice(0, 10) === today)
        .reduce((a, r) => a + num(r.amount), 0);
      if (avgSum > 0 && todayTotal < 0.7 * avgSum) {
        push('revenue_dip', 'critical', 'Revenue dip',
          `Aaj ki collection Rs ${fmt(todayTotal)} hai — 7-day daily average Rs ${fmt(avgSum)} se ${Math.round((1 - todayTotal / avgSum) * 100)}% kam.`);
      }
    }
  } catch (e) { console.error('[anomaly] revenue_dip failed:', e.message); }

  // 3) Booking cancellations spike — aaj >= 2x 7-day daily avg (baseline kam se kam 1 honi chahiye)
  try {
    if (prisma.booking) {
      const since = new Date(startOfDay().getTime() - 8 * DAY);
      const rows = await prisma.booking.findMany({
        where: { tenantId, status: 'cancelled', updatedAt: { gte: since } },
        select: { updatedAt: true },
      });
      const byDay = {};
      for (const r of rows) {
        const k = startOfDay(new Date(r.updatedAt)).toISOString().slice(0, 10);
        byDay[k] = (byDay[k] || 0) + 1;
      }
      const baseVals = Object.entries(byDay).filter(([k]) => k !== today).map(([, v]) => v);
      const avg = baseVals.length ? baseVals.reduce((a, b) => a + b, 0) / 7 : 0;
      const todayN = byDay[today] || 0;
      if (avg >= 0.5 && todayN >= Math.max(2, 2 * avg)) {
        push('cancel_spike', 'warning', 'Cancellations spike',
          `Aaj ${todayN} bookings cancel huin — 7-day daily average ${avg.toFixed(1)} se zyada.`);
      }
    }
  } catch (e) { console.error('[anomaly] cancel_spike failed:', e.message); }

  // 4) Failed payments spike — pichhle 24h failed >= 2x 7-day daily avg
  try {
    if (prisma.onlinePayment) {
      const since = new Date(startOfDay().getTime() - 8 * DAY);
      const rows = await prisma.onlinePayment.findMany({
        where: { tenantId, status: 'failed', createdAt: { gte: since } },
        select: { createdAt: true },
      });
      const byDay = {};
      for (const r of rows) {
        const k = startOfDay(new Date(r.createdAt)).toISOString().slice(0, 10);
        byDay[k] = (byDay[k] || 0) + 1;
      }
      const baseVals = Object.entries(byDay).filter(([k]) => k !== today).map(([, v]) => v);
      const avg = baseVals.length ? baseVals.reduce((a, b) => a + b, 0) / 7 : 0;
      const todayN = byDay[today] || 0;
      if (avg >= 0.5 && todayN >= Math.max(2, 2 * avg)) {
        push('failed_payments', 'critical', 'Failed payments spike',
          `Pichhle 24h me ${todayN} online payments fail huin — 7-day daily average ${avg.toFixed(1)}. Gateway check karein.`);
      }
    }
  } catch (e) { console.error('[anomaly] failed_payments failed:', e.message); }

  // Dedupe + alert dispatch: notification (ceo/admin/manager) + optional email.
  const sent = [];
  for (const a of alerts) {
    const dup = await prisma.notification.count({
      where: { tenantId, message: { startsWith: a.key } },
    }).catch(() => 1);
    if (dup > 0) continue; // aaj ye alert pehle bheja ja chuka

    const fullMsg = `${a.key} ${a.title}: ${a.detail}`;
    for (const role of ['ceo', 'admin', 'manager']) {
      await prisma.notification.create({
        data: { tenantId, role, type: 'general', message: fullMsg },
      }).catch(() => {});
    }
    sent.push(a);

    // Optional email — tenant admins ko (fail-safe, email config na ho to skip).
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
          subject: `⚠️ ${a.title} — anomaly detected`,
          html: `<p>${a.detail}</p><p>Techub anomaly detector ne ye alert auto-generate kiya hai.</p>`,
        }).catch(() => {});
      }
    } catch { /* email optional — notification hi kafi hai */ }
  }

  return { ok: true, alerts: sent.map((a) => ({ key: a.key, severity: a.severity, title: a.title })) };
}

// Saare active tenants par chalao (job handler se).
async function processAnomalies() {
  try {
    const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
    let total = 0;
    for (const t of tenants) {
      const r = await detectForTenant(t.id).catch(() => null);
      if (r) total += r.alerts.length;
    }
    // Kal ke liye dobara schedule.
    try {
      const jobs = getJobs();
      if (jobs) await jobs.enqueue('anomaly-scan', {}, { runAt: new Date(Date.now() + DAY) });
    } catch { /* ignore */ }
    return { ok: true, tenants: tenants.length, alerts: total };
  } catch (e) {
    console.error('[anomaly] processAnomalies failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('anomaly-scan', processAnomalies);
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

// Boot par ensure karo ke daily 8am run scheduled hai.
async function ensureAnomalyScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'anomaly-scan', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const eight = new Date();
      eight.setHours(8, 0, 0, 0);
      if (eight.getTime() < Date.now()) eight.setDate(eight.getDate() + 1);
      await jobs.enqueue('anomaly-scan', {}, { runAt: eight });
    }
  } catch (e) {
    console.error('[anomaly] ensure schedule failed:', e.message);
  }
}

module.exports = { detectForTenant, processAnomalies, ensureAnomalyScheduled };
