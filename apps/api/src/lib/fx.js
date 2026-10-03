// Phase 46 Track 2: FX rate helper library.
// - getRate(tenantId, from, to, date?) → latest applicable rate (direct → inverse → base-bridge)
// - convert(amount, tenantId, from, to) → converted amount (Decimal-safe)
// - setManualRate / refreshAutoRates / ensureFxScheduled (daily auto update)
// Missing rate par kabhi silent wrong math nahi — explicit FX_RATE_MISSING error throw hota hai.
//
// Coordinator (server.js, additive):
//   require('./lib/fx');
//   require('./lib/fx').ensureFxScheduled();
const prisma = require('./prisma');
const { assertUrlSafe } = require('./safeFetch');

const CODE_RE = /^[A-Z]{3}$/;
const FX_JOB_TYPE = 'fx-refresh';
const AUTO_API = 'https://open.er-api.com/v6/latest/';

function normalizeCurrency(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) {
    const e = new Error(`Invalid currency code: ${code}`);
    e.code = 'INVALID_CURRENCY';
    throw e;
  }
  return c;
}

function toNumber(v) {
  // Prisma Decimal ko number me badlo bina precision khoey (18,6 safe hai).
  return v == null ? null : Number(v.toString());
}

// Tenant ka base currency — Track 1 (currency-settings) merge na ho to PKR default.
async function getBaseCurrency(tenantId) {
  try {
    if (prisma.currencySetting) {
      const s = await prisma.currencySetting.findUnique({ where: { tenantId } });
      if (s && s.baseCurrency) return normalizeCurrency(s.baseCurrency);
    }
  } catch { /* column/merge pending → default */ }
  return 'PKR';
}

function hasModel() {
  return !!prisma.fxRate;
}

// Latest rate row for a pair on/before `date` (default: aaj).
async function latestRateRow(tenantId, from, to, date) {
  return prisma.fxRate.findFirst({
    where: {
      tenantId,
      fromCurrency: from,
      toCurrency: to,
      effectiveDate: date ? { lte: date } : undefined,
    },
    orderBy: { effectiveDate: 'desc' },
  });
}

/**
 * getRate(tenantId, from, to, date?) → { rate, source, effectiveDate }
 * Resolution order: direct → inverse (1/rate) → base-currency bridge (from→base→to).
 * Agar koi bhi path na mile to FX_RATE_MISSING throw karta hai (kabhi 1.0 assume nahi).
 */
async function getRate(tenantId, from, to, date = null) {
  if (!tenantId) throw new Error('tenantId required');
  const f = normalizeCurrency(from);
  const t = normalizeCurrency(to);
  if (f === t) return { rate: 1, source: 'identity', effectiveDate: date || new Date() };
  if (!hasModel()) {
    const e = new Error('FX rates not migrated yet');
    e.code = 'FX_NOT_MIGRATED';
    throw e;
  }

  const direct = await latestRateRow(tenantId, f, t, date);
  if (direct && toNumber(direct.rate) > 0) {
    return { rate: toNumber(direct.rate), source: direct.source, effectiveDate: direct.effectiveDate };
  }

  const inverse = await latestRateRow(tenantId, t, f, date);
  if (inverse && toNumber(inverse.rate) > 0) {
    return { rate: 1 / toNumber(inverse.rate), source: `${inverse.source}/inverse`, effectiveDate: inverse.effectiveDate };
  }

  const base = await getBaseCurrency(tenantId);
  if (f !== base && t !== base) {
    const leg1 = await getRate(tenantId, f, base, date);
    const leg2 = await getRate(tenantId, base, t, date);
    return {
      rate: leg1.rate * leg2.rate,
      source: `bridge:${base} (${leg1.source}+${leg2.source})`,
      effectiveDate: leg1.effectiveDate > leg2.effectiveDate ? leg1.effectiveDate : leg2.effectiveDate,
    };
  }

  const e = new Error(`No FX rate available for ${f} → ${t}. Please add a rate first.`);
  e.code = 'FX_RATE_MISSING';
  e.details = { from: f, to: t };
  throw e;
}

/**
 * convert(amount, tenantId, from, to) → rounded converted amount (2 dp).
 * Note: signature me tenantId second parameter hai — tenant-scoped rates ke liye lazmi hai.
 */
async function convert(amount, tenantId, from, to) {
  const amt = Number(amount);
  if (!Number.isFinite(amt)) throw new Error('amount must be a number');
  const { rate } = await getRate(tenantId, from, to);
  return Math.round(amt * rate * 100) / 100;
}

// Aaj ki UTC midnight (rates effectiveDate ka canonical value).
function todayMidnight() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Manual rate upsert — aaj (ya di hui date) ke liye pair ka latest rate ban jata hai.
async function setManualRate(tenantId, from, to, rate, opts = {}) {
  const f = normalizeCurrency(from);
  const t = normalizeCurrency(to);
  if (f === t) {
    const e = new Error('from and to currencies must differ');
    e.code = 'INVALID_CURRENCY_PAIR';
    throw e;
  }
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) {
    const e = new Error('rate must be a positive number');
    e.code = 'INVALID_RATE';
    throw e;
  }
  const effectiveDate = opts.effectiveDate instanceof Date ? opts.effectiveDate : todayMidnight();
  return prisma.fxRate.upsert({
    where: { tenantId_fromCurrency_toCurrency_effectiveDate: { tenantId, fromCurrency: f, toCurrency: t, effectiveDate } },
    update: { rate: r, source: 'manual' },
    create: { tenantId, fromCurrency: f, toCurrency: t, rate: r, source: 'manual', effectiveDate },
  });
}

// --- Auto-update (free, no key needed) ---
// open.er-api.com se base currency ke rates le kar enabled currencies ke liye store karta hai.
// Credentials required nahi — free endpoint unavailable ho to fail-safe skip (throw nahi).
async function refreshAutoRates(tenantId = null) {
  if (!hasModel()) return { skipped: true, reason: 'not_migrated' };
  let tenants = [];
  try {
    const where = { status: 'active' };
    tenants = tenantId
      ? await prisma.tenant.findMany({ where: { ...where, id: tenantId } })
      : await prisma.tenant.findMany({ where });
  } catch {
    return { skipped: true, reason: 'tenant_query_failed' };
  }

  const results = [];
  for (const tenant of tenants) {
    try {
      const base = await getBaseCurrency(tenant.id);
      const url = `${AUTO_API}${base}`;
      await assertUrlSafe(url); // SSRF check (host whitelist nahi, but private/loopback blocked)
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let payload;
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        payload = await res.json();
      } finally {
        clearTimeout(timer);
      }
      const rates = payload && payload.result === 'success' && payload.rates ? payload.rates : null;
      if (!rates) {
        results.push({ tenantId: tenant.id, skipped: true, reason: 'bad_payload' });
        continue;
      }
      // Enabled currencies (Track 1 merge na ho to common set use karo).
      let targets = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'PKR'];
      try {
        if (prisma.currencySetting) {
          const s = await prisma.currencySetting.findUnique({ where: { tenantId: tenant.id } });
          if (s && Array.isArray(s.enabledCurrencies) && s.enabledCurrencies.length) {
            targets = s.enabledCurrencies.map(normalizeCurrency).filter((c) => c !== base);
          }
        }
      } catch { /* default targets */ }

      const eff = todayMidnight();
      let stored = 0;
      for (const cur of targets) {
        const rate = Number(rates[cur]);
        if (!Number.isFinite(rate) || rate <= 0) continue;
        await prisma.fxRate.upsert({
          where: { tenantId_fromCurrency_toCurrency_effectiveDate: { tenantId: tenant.id, fromCurrency: base, toCurrency: cur, effectiveDate: eff } },
          update: { rate, source: 'auto' },
          create: { tenantId: tenant.id, fromCurrency: base, toCurrency: cur, rate, source: 'auto', effectiveDate: eff },
        });
        stored += 1;
      }
      results.push({ tenantId: tenant.id, stored, base });
    } catch (e) {
      results.push({ tenantId: tenant.id, skipped: true, reason: String((e && e.message) || e).slice(0, 120) });
    }
  }
  return { results };
}

// --- Daily job wiring ---
function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

async function runFxRefreshJob() {
  await refreshAutoRates();
}

async function ensureFxScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    jobs.registerHandler(FX_JOB_TYPE, runFxRefreshJob);
    const pending = await prisma.job.count({ where: { type: FX_JOB_TYPE, status: 'pending' } }).catch(() => 1);
    if (pending === 0) {
      const runAt = new Date();
      runAt.setUTCHours(2, 0, 0, 0); // roz ~subah 7 PKT (2 UTC)
      if (runAt <= new Date()) runAt.setDate(runAt.getDate() + 1);
      await jobs.enqueue(FX_JOB_TYPE, {}, { runAt }).catch(() => {});
    }
  } catch { /* job system missing → silent skip */ }
}

module.exports = {
  getRate,
  convert,
  setManualRate,
  refreshAutoRates,
  ensureFxScheduled,
  normalizeCurrency,
  getBaseCurrency,
  FX_JOB_TYPE,
};
