// Phase 46 — Base-currency reporting helpers.
// Reads multi-currency fields (currency / baseAmount) defensively: tracks 3/4
// merge them in parallel; until merged, falls back to plain `amount`.
const prisma = require('./prisma');

const num = (v) => Number(v || 0);

// Cache: does a column exist on a table? (avoids P2022 before tracks 3/4 merge)
const colCache = new Map();
async function columnExists(table, column) {
  const key = `${table}.${column}`;
  if (colCache.has(key)) return colCache.get(key);
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      table,
      column
    );
    const ok = rows.length > 0;
    colCache.set(key, ok);
    return ok;
  } catch {
    colCache.set(key, false);
    return false;
  }
}

async function modelExists(model) {
  try {
    const d = prisma._dmmf && prisma._dmmf.modelMap ? prisma._dmmf.modelMap[model] : null;
    return !!d;
  } catch { return false; }
}

// Tenant's base currency (CurrencySetting merged ho to, warna PKR).
async function getBaseCurrency(tenantId) {
  try {
    if (await modelExists('CurrencySetting')) {
      const s = await prisma.currencySetting.findUnique({ where: { tenantId } });
      if (s && s.baseCurrency) return s.baseCurrency;
    }
  } catch { /* fall through */ }
  return 'PKR';
}

// Pick per-row display amount: baseAmount when currencyView=base and column exists.
async function amountSelectors() {
  const [invBase, payBase, expBase] = await Promise.all([
    columnExists('invoices', 'base_amount'),
    columnExists('payments', 'base_amount'),
    columnExists('expenses', 'base_amount'),
  ]);
  return { invBase, payBase, expBase };
}

function rowBase(row, hasBase, view) {
  if (view === 'base' && hasBase && row.baseAmount != null) return num(row.baseAmount);
  return num(row.amount);
}
function rowCurrency(row, hasBase, view, baseCurrency) {
  if (view === 'base' && hasBase && row.baseAmount != null) return baseCurrency;
  return row.currency || baseCurrency;
}

/**
 * reportTotals(tenantId, {from, to, currencyView})
 * → { base: {currency, revenue, expenses, outstanding, profit},
 *     byCurrency: { USD: {revenue, expenses, outstanding}, ... },
 *     currencyView, multiCurrency: bool }
 */
async function reportTotals(tenantId, opts = {}) {
  const { from, to } = opts;
  const view = opts.currencyView === 'original' ? 'original' : 'base'; // default base
  const baseCurrency = await getBaseCurrency(tenantId);
  const { invBase, payBase, expBase } = await amountSelectors();

  const dateWhere = (field) => {
    const w = {};
    if (from) w.gte = new Date(from);
    if (to) w.lte = new Date(to);
    return Object.keys(w).length ? { [field]: w } : {};
  };

  const invSel = { amount: true, amountPaid: true, status: true, dueDate: true, createdAt: true };
  const paySel = { amount: true, paidAt: true };
  const expSel = { amount: true, date: true, status: true };
  if (invBase) { invSel.baseAmount = true; invSel.currency = true; }
  if (payBase) { paySel.baseAmount = true; paySel.currency = true; }
  if (expBase) { expSel.baseAmount = true; expSel.currency = true; }

  const [invoices, payments, expenses] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, invoiceType: { not: 'proforma' }, ...dateWhere('createdAt') },
      select: invSel,
    }),
    prisma.payment.findMany({
      where: { tenantId, ...dateWhere('paidAt') },
      select: paySel,
    }),
    prisma.expense.findMany({
      where: { tenantId, status: 'approved', ...dateWhere('date') },
      select: expSel,
    }),
  ]);

  const byCurrency = {};
  const bucket = (cur) => (byCurrency[cur] = byCurrency[cur] || { revenue: 0, expenses: 0, outstanding: 0 });

  let baseRevenue = 0, baseExpenses = 0, baseOutstanding = 0;
  for (const p of payments) {
    const amt = rowBase(p, payBase, view);
    const cur = rowCurrency(p, payBase, view, baseCurrency);
    baseRevenue += (view === 'base' ? amt : num(p.amount));
    bucket(cur).revenue += num(p.amount);
  }
  for (const e of expenses) {
    const amt = rowBase(e, expBase, view);
    const cur = rowCurrency(e, expBase, view, baseCurrency);
    baseExpenses += (view === 'base' ? amt : num(e.amount));
    bucket(cur).expenses += num(e.amount);
  }
  for (const i of invoices) {
    const out = Math.max(0, num(i.amount) - num(i.amountPaid));
    if (out <= 0) continue;
    const cur = rowCurrency(i, invBase, view, baseCurrency);
    // Outstanding in base: scale by invoice's own base ratio when available.
    let baseOut = out;
    if (view === 'base' && invBase && i.baseAmount != null && num(i.amount) > 0) {
      baseOut = (out / num(i.amount)) * num(i.baseAmount);
    }
    baseOutstanding += baseOut;
    bucket(cur).outstanding += out;
  }

  // base totals always expressed in base currency; byCurrency in original currencies.
  const round2 = (v) => Math.round(v * 100) / 100;
  const out = {
    base: {
      currency: baseCurrency,
      revenue: round2(baseRevenue),
      expenses: round2(baseExpenses),
      outstanding: round2(baseOutstanding),
      profit: round2(baseRevenue - baseExpenses),
    },
    byCurrency: {},
    currencyView: view,
    multiCurrency: Object.keys(byCurrency).length > 1,
  };
  for (const [cur, b] of Object.entries(byCurrency)) {
    out.byCurrency[cur] = { revenue: round2(b.revenue), expenses: round2(b.expenses), outstanding: round2(b.outstanding) };
  }
  return out;
}

// Monthly revenue trend (base currency), last `months` months.
async function revenueTrend(tenantId, months = 6, currencyView = 'base') {
  const view = currencyView === 'original' ? 'original' : 'base';
  const baseCurrency = await getBaseCurrency(tenantId);
  const { payBase } = await amountSelectors();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const sel = { amount: true, paidAt: true };
  if (payBase) { sel.baseAmount = true; sel.currency = true; }
  const payments = await prisma.payment.findMany({
    where: { tenantId, paidAt: { gte: start } },
    select: sel,
  });
  const buckets = {};
  for (const p of payments) {
    const d = new Date(p.paidAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const amt = view === 'base' ? rowBase(p, payBase, view) : num(p.amount);
    buckets[key] = (buckets[key] || 0) + amt;
  }
  const trend = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    trend.push({ month: key, revenue: Math.round((buckets[key] || 0) * 100) / 100, currency: baseCurrency });
  }
  return { currency: baseCurrency, currencyView: view, trend };
}

// AR aging buckets in base currency.
async function arAging(tenantId, currencyView = 'base') {
  const view = currencyView === 'original' ? 'original' : 'base';
  const baseCurrency = await getBaseCurrency(tenantId);
  const { invBase } = await amountSelectors();
  const sel = { amount: true, amountPaid: true, dueDate: true };
  if (invBase) { sel.baseAmount = true; sel.currency = true; }
  const invoices = await prisma.invoice.findMany({
    where: { tenantId, status: { in: ['unpaid', 'partial'] }, invoiceType: { not: 'proforma' } },
    select: sel,
  });
  const now = new Date();
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const i of invoices) {
    const out = Math.max(0, num(i.amount) - num(i.amountPaid));
    if (out <= 0) continue;
    let baseOut = out;
    if (view === 'base' && invBase && i.baseAmount != null && num(i.amount) > 0) {
      baseOut = (out / num(i.amount)) * num(i.baseAmount);
    }
    const days = Math.floor((now - new Date(i.dueDate)) / 86400000);
    const amt = view === 'base' ? baseOut : out;
    if (days <= 0) buckets.current += amt;
    else if (days <= 30) buckets.d1_30 += amt;
    else if (days <= 60) buckets.d31_60 += amt;
    else if (days <= 90) buckets.d61_90 += amt;
    else buckets.d90_plus += amt;
  }
  const round2 = (v) => Math.round(v * 100) / 100;
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  return {
    currency: baseCurrency, currencyView: view,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v)])),
    total: round2(total),
  };
}

module.exports = { reportTotals, revenueTrend, arAging, getBaseCurrency, columnExists };
