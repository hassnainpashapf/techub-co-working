// Phase 46 Track 3: invoice currency resolution helper.
// Track 2 (lib/fx.js) ka getRate lazily use karta hai — merge na ho to safe error.
// Koi mock nahi: rate missing ho to invoice nahi banta (galat math se behtar).

const prisma = require('./prisma');

const DEFAULT_BASE = 'PKR';

const CURRENCY_SYMBOLS = {
  PKR: 'Rs', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', SAR: '﷼',
  INR: '₹', CAD: 'C$', AUD: 'A$', CNY: '¥', JPY: '¥', CHF: 'CHF ',
  TRY: '₺', QAR: 'QR', KWD: 'KD', BHD: 'BD', OMR: 'RO', MYR: 'RM',
};

function isValidCurrencyCode(code) {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

function currencySymbol(code) {
  return CURRENCY_SYMBOLS[String(code || '').toUpperCase()] || `${code} `;
}

// Tenant ki base + default invoice currency (Track 1 ka model merge na ho to PKR).
async function getTenantCurrencies(tenantId) {
  try {
    if (!prisma.currencySetting) return { base: DEFAULT_BASE, def: null };
    const s = await prisma.currencySetting.findUnique({ where: { tenantId } });
    if (!s) return { base: DEFAULT_BASE, def: null };
    return {
      base: String(s.baseCurrency || DEFAULT_BASE).toUpperCase(),
      def: s.defaultInvoiceCurrency ? String(s.defaultInvoiceCurrency).toUpperCase() : null,
    };
  } catch {
    return { base: DEFAULT_BASE, def: null }; // merge pending → safe default
  }
}

// Lazy require taake Track 2 ka lib merge na ho to bhi crash na ho.
function getFxLib() {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require('./fx');
  } catch {
    return null;
  }
}

// Invoice create ke liye currency fields resolve karo.
// Returns { currency, fxRate, baseAmount } — fxRate/baseAmount Decimal-compatible numbers.
async function resolveInvoiceCurrency(tenantId, requestedCurrency, amount) {
  const { base, def } = await getTenantCurrencies(tenantId);
  let currency = String(requestedCurrency || def || base).toUpperCase();
  if (!isValidCurrencyCode(currency)) {
    const e = new Error(`Invalid currency code: ${requestedCurrency}`);
    e.status = 422;
    throw e;
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    const e = new Error('Invalid invoice amount');
    e.status = 422;
    throw e;
  }
  if (currency === base) {
    return { currency, fxRate: 1, baseAmount: Math.round(amt * 100) / 100 };
  }
  const fx = getFxLib();
  if (!fx || typeof fx.getRate !== 'function') {
    const e = new Error('FX rates not available yet — invoice sirf base currency me ban sakta hai');
    e.status = 422;
    throw e;
  }
  let rate;
  try {
    rate = await fx.getRate(tenantId, currency, base);
  } catch (err) {
    const e = new Error(`FX rate missing: 1 ${currency} → ${base}. Pehle FX rate set karein.`);
    e.status = 422;
    e.cause = err;
    throw e;
  }
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) {
    const e = new Error(`Invalid FX rate for ${currency} → ${base}`);
    e.status = 422;
    throw e;
  }
  return {
    currency,
    fxRate: r,
    baseAmount: Math.round(amt * r * 100) / 100,
  };
}

// Balance ko base currency me dikhane ke liye (overdue/dunning).
function baseBalanceOf(invoice) {
  const balance = Number(invoice.amount) - Number(invoice.amountPaid || 0);
  const rate = invoice.fxRate != null ? Number(invoice.fxRate) : 1;
  return Math.round(balance * rate * 100) / 100;
}

module.exports = {
  DEFAULT_BASE,
  CURRENCY_SYMBOLS,
  isValidCurrencyCode,
  currencySymbol,
  getTenantCurrencies,
  resolveInvoiceCurrency,
  baseBalanceOf,
};
