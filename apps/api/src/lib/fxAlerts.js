// Phase 46 Track 9: Exchange Rate Alerts — daily job.
// Server.js mat chhero. Coordinator wiring (additive):
//   require('./lib/fxAlerts');                            // 'fx-alerts' handler auto-register
//   require('./lib/fxAlerts').ensureFxAlertsScheduled();   // daily subah 9 baje
//
// INTEGRATION NOTE (Track 1 — Currency Settings): alert threshold configurable
// karne ke liye CurrencySetting model me `fxAlertThresholdPct Float?`
// (default 3.0) field jorein. Jab tak field merge nahi hoti, yeh lib
// `settings.fxAlertThresholdPct` ko defensive read karti hai (undefined -> 3%).
//
// Guards: CurrencySetting/FxRate models merge na hue hon to gracefully skip
// (koi crash nahi). Har alert me asal numbers; tenantFilter-equivalent:
// har query tenantId-scoped hai (job context — koi user request nahi).

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

const DEFAULT_THRESHOLD_PCT = 3.0;
const STALE_DAYS = 7;

function getJobs() {
  try {
    return require('./jobs');
  } catch {
    return null;
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(date, n) {
  return new Date(date.getTime() - n * 24 * 60 * 60 * 1000);
}

// Alert targets — finance role enum me `finance_officer` hai.
const ALERT_ROLES = ['ceo', 'admin', 'finance_officer'];

async function tenantEmails(tenantId) {
  try {
    const users = await prisma.user.findMany({
      where: { tenantId, role: { in: ALERT_ROLES }, isActive: true, email: { not: null } },
      select: { email: true },
    });
    return users.map((u) => u.email).filter(Boolean);
  } catch {
    return [];
  }
}

async function alreadySentToday(tenantId, dedupeKey) {
  try {
    const count = await prisma.notification.count({
      where: { tenantId, message: { startsWith: `[fx-alert:${dedupeKey}]` } },
    });
    return count > 0;
  } catch {
    return true; // DB issue ho to dobara bhejne se behtar hai skip karna
  }
}

async function raiseAlert(tenantId, dedupeKey, title, detail) {
  if (await alreadySentToday(tenantId, dedupeKey)) return { sent: false, reason: 'duplicate' };
  const fullMsg = `[fx-alert:${dedupeKey}] ${title} — ${detail}`;
  for (const role of ALERT_ROLES) {
    try {
      await prisma.notification.create({
        data: { tenantId, role, type: 'general', message: fullMsg },
      });
    } catch { /* ek role fail ho to baqi jayein */ }
  }
  // Optional email (fail-safe — email config na ho to skip).
  try {
    const emails = await tenantEmails(tenantId);
    if (emails.length) {
      await sendEmail(tenantId, emails, 'fxAlert', { title, detail }).catch(() => {});
    }
  } catch { /* ignore */ }
  return { sent: true };
}

async function checkTenant(tenantId) {
  const results = [];
  let settings;
  try {
    settings = await prisma.currencySetting.findUnique({ where: { tenantId } });
  } catch {
    return [{ ok: false, reason: 'settings_not_migrated' }];
  }
  if (!settings) return [{ ok: false, reason: 'no_settings' }];

  const threshold = Number(settings.fxAlertThresholdPct ?? DEFAULT_THRESHOLD_PCT) || DEFAULT_THRESHOLD_PCT;
  const base = String(settings.baseCurrency || 'PKR').toUpperCase();
  let enabled = [];
  try {
    const raw = settings.enabledCurrencies;
    enabled = (Array.isArray(raw) ? raw : []).map((c) => String(c).toUpperCase());
  } catch { enabled = []; }
  if (!enabled.includes(base)) enabled.push(base);
  enabled = [...new Set(enabled)];

  const now = new Date();
  const weekAgo = daysAgo(now, STALE_DAYS);
  const tk = todayKey();

  for (const cur of enabled) {
    if (cur === base) continue;
    const pair = `${cur}/${base}`;
    let latest;
    try {
      latest = await prisma.fxRate.findFirst({
        where: { tenantId, fromCurrency: cur, toCurrency: base },
        orderBy: { effectiveDate: 'desc' },
      });
    } catch {
      results.push({ pair, ok: false, reason: 'fxrate_not_migrated' });
      continue;
    }

    // 1) Missing rate.
    if (!latest) {
      const key = `${tk}:${pair}:missing`;
      const r = await raiseAlert(
        tenantId, key,
        `⚠️ ${pair} ka exchange rate set nahi`,
        `${cur} enabled currency hai lekin ${base} ke muqable me koi rate maujood nahi — Currency settings me rate add karein taake conversions durust hon.`
      );
      results.push({ pair, kind: 'missing', ...r });
      continue;
    }

    const latestRate = Number(latest.rate);
    const latestDate = new Date(latest.effectiveDate);

    // 2) Stale rate (>7 din purana).
    if (latestDate < weekAgo) {
      const staleDays = Math.floor((now.getTime() - latestDate.getTime()) / (24 * 60 * 60 * 1000));
      const key = `${tk}:${pair}:stale`;
      const r = await raiseAlert(
        tenantId, key,
        `⚠️ ${pair} ka rate ${staleDays} din purana hai`,
        `Akhir rate ${latestDate.toISOString().slice(0, 10)} ka hai (${latestRate}) — naya rate update karein ya auto FX source on karein.`
      );
      results.push({ pair, kind: 'stale', staleDays, ...r });
      continue;
    }

    // 3) 7-day me bari movement (>threshold%).
    let old = null;
    try {
      old = await prisma.fxRate.findFirst({
        where: { tenantId, fromCurrency: cur, toCurrency: base, effectiveDate: { lte: weekAgo } },
        orderBy: { effectiveDate: 'desc' },
      });
    } catch { /* ignore */ }
    if (old) {
      const oldRate = Number(old.rate);
      if (oldRate > 0) {
        const pct = ((latestRate - oldRate) / oldRate) * 100;
        if (Math.abs(pct) >= threshold) {
          const dir = pct > 0 ? 'mehnga' : 'sasta';
          const key = `${tk}:${pair}:move`;
          const r = await raiseAlert(
            tenantId, key,
            `🚨 ${pair} 7 din me ${Math.abs(pct).toFixed(2)}% ${dir}`,
            `Rate ${oldRate} se ${latestRate} hua (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%) — threshold ${threshold}%. Foreign-currency invoices/payments par asar par sakta hai.`
          );
          results.push({ pair, kind: 'movement', pct: Number(pct.toFixed(2)), ...r });
          continue;
        }
      }
    }
    results.push({ pair, kind: 'ok' });
  }
  return results;
}

async function processFxAlerts() {
  if (!prisma.currencySetting || !prisma.fxRate) {
    console.error('[fx-alerts] CurrencySetting/FxRate models not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }
  let tenants = [];
  try {
    tenants = await prisma.tenant.findMany({ select: { id: true } });
  } catch (e) {
    console.error('[fx-alerts] tenants read failed:', e.message);
    return { ok: false, reason: 'tenants_read_failed' };
  }
  const summary = { tenants: tenants.length, alerts: 0 };
  for (const t of tenants) {
    try {
      const res = await checkTenant(t.id);
      summary.alerts += res.filter((r) => r.sent).length;
    } catch (e) {
      console.error('[fx-alerts] tenant check failed:', t.id, e.message);
    }
  }
  return { ok: true, ...summary };
}

// Auto-register with the job queue when available (docExpiryJob pattern).
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('fx-alerts', processFxAlerts);
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

// Boot par ensure karo ke daily 9am run scheduled hai.
async function ensureFxAlertsScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'fx-alerts', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const nine = new Date();
      nine.setHours(9, 0, 0, 0);
      if (nine.getTime() < Date.now()) nine.setDate(nine.getDate() + 1);
      await jobs.enqueue('fx-alerts', {}, { runAt: nine });
    }
  } catch (e) {
    console.error('[fx-alerts] ensure schedule failed:', e.message);
  }
}

module.exports = { processFxAlerts, ensureFxAlertsScheduled, checkTenant };
