// Phase 46 Track 10: Finance Currency Dashboard — API.
// Coordinator: mount with app.use('/api/currency-dashboard', require('./routes/currency-dashboard'));
// Sidebar link: nahi — finance dashboard page me CurrencyWidget embed hoga.
// NOTE: Phase 46 models (CurrencySetting, FxRate, FxGainLoss, Invoice/Payment
// currency fields) merge se pehle har section defensive hai — kuch missing ho
// to wo section empty/0 aata hai, poora endpoint 500 nahi hota.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'finance'));

const toNum = (v) => Number(v || 0);

// Mahine ka pehla din (UTC) — MTD totals ke liye
function monthStart() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Aggregate try: pehle base_amount (multi-currency) via raw SQL —
// P2022/42703 (column abhi migrate nahi hui) aaye to amount par fallback.
// Raw SQL is liye: merge se pehle Prisma client me field hai hi nahi.
async function sumBaseAmount(table, dateCol, where, dateVal) {
  try {
    const r = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(base_amount),0) AS s FROM "${table}" WHERE tenant_id = $1 AND "${dateCol}" >= $2`,
      where.tenantId, dateVal
    );
    return toNum(r[0] && r[0].s);
  } catch (e) {
    if (e && (e.code === '42703' || e.code === 'P2022')) return null; // column abhi migrate nahi hui
    throw e;
  }
}

router.get('/overview', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const start = monthStart();

    // --- 1. Currency settings (guarded) ---
    let baseCurrency = 'PKR';
    let enabledCurrencies = ['PKR'];
    let settingsMigrated = false;
    if (prisma.currencySetting) {
      try {
        const s = await prisma.currencySetting.findUnique({ where: { tenantId: tf.tenantId } });
        if (s) {
          baseCurrency = s.baseCurrency || 'PKR';
          enabledCurrencies = Array.isArray(s.enabledCurrencies) && s.enabledCurrencies.length
            ? s.enabledCurrencies
            : [baseCurrency];
          settingsMigrated = true;
        }
      } catch (e) { if (!e || e.code !== 'P2022') throw e; }
    }

    // --- 2. Base-currency totals MTD ---
    let revenueMtd = await sumBaseAmount('payments', 'paid_at', tf, start);
    if (revenueMtd === null) {
      const p = await prisma.payment.aggregate({ _sum: { amount: true }, where: { ...tf, paidAt: { gte: start } } });
      revenueMtd = toNum(p._sum.amount);
    }
    let expenseMtd = 0;
    try {
      const e = await prisma.expense.aggregate({ _sum: { amount: true }, where: { ...tf, date: { gte: start } } });
      expenseMtd = toNum(e._sum.amount);
    } catch (e) { if (!e || e.code !== 'P2022') throw e; }

    // Outstanding (open invoices): base-currency aware, fallback amount-based
    let outstanding = 0;
    let outstandingMigrated = true;
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT i.id, COALESCE(i.base_amount, i.amount) AS base_total,
                COALESCE(SUM(p.base_amount), 0) AS base_paid
         FROM "invoices" i LEFT JOIN "payments" p ON p.invoice_id = i.id
         WHERE i.tenant_id = $1 AND i.status IN ('unpaid','partial','overdue')
         GROUP BY i.id`,
        tf.tenantId
      );
      outstanding = rows.reduce((a, r) => a + Math.max(0, toNum(r.base_total) - toNum(r.base_paid)), 0);
    } catch (e) {
      if (e && (e.code === 'P2022' || e.code === '42703')) {
        // currency columns abhi migrate nahi — purana tareeqa
        const invs = await prisma.invoice.findMany({
          where: { ...tf, status: { in: ['unpaid', 'partial', 'overdue'] } },
          select: { amount: true, amountPaid: true },
        });
        outstanding = invs.reduce((a, i) => a + (toNum(i.amount) - toNum(i.amountPaid)), 0);
        outstandingMigrated = false;
      } else throw e;
    }

    // --- 3. Per-currency exposure table (guarded — currency column merge se pehle empty) ---
    let exposure = [];
    let exposureMigrated = false;
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT currency, COUNT(*)::int AS invoices, COALESCE(SUM(amount),0) AS total, COALESCE(SUM(base_amount),0) AS "baseTotal"
         FROM "invoices" WHERE tenant_id = $1 AND status IN ('unpaid','partial','overdue','paid')
         GROUP BY currency ORDER BY "baseTotal" DESC`,
        tf.tenantId
      );
      exposure = rows.map((g) => ({
        currency: g.currency || baseCurrency,
        invoices: g.invoices,
        total: toNum(g.total),
        baseTotal: toNum(g.baseTotal),
      }));
      exposureMigrated = true;
    } catch (e) { if (!e || (e.code !== 'P2022' && e.code !== '42703')) throw e; }

    // --- 4. Latest FX rates (guarded) ---
    let rates = [];
    let ratesMigrated = false;
    if (prisma.fxRate) {
      try {
        rates = await prisma.fxRate.findMany({
          where: tf,
          orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }, { effectiveDate: 'desc' }],
          take: 60,
        });
        // Har pair ka latest rate
        const seen = new Set();
        rates = rates.filter((r) => {
          const k = `${r.fromCurrency}->${r.toCurrency}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).map((r) => ({
          from: r.fromCurrency,
          to: r.toCurrency,
          rate: toNum(r.rate),
          source: r.source,
          effectiveDate: r.effectiveDate,
          stale: (Date.now() - new Date(r.effectiveDate).getTime()) > 7 * 24 * 3600 * 1000,
        }));
        ratesMigrated = true;
      } catch (e) { if (!e || e.code !== 'P2022') throw e; }
    }

    // --- 5. FX gain/loss MTD (guarded — track 5 ka model) ---
    let fxGainMtd = 0;
    let fxLossMtd = 0;
    let fxMigrated = false;
    if (prisma.fxGainLoss) {
      try {
        const rows = await prisma.fxGainLoss.findMany({ where: { ...tf, createdAt: { gte: start } }, select: { amount: true } });
        for (const r of rows) {
          const a = toNum(r.amount);
          if (a >= 0) fxGainMtd += a; else fxLossMtd += Math.abs(a);
        }
        fxMigrated = true;
      } catch (e) { if (!e || e.code !== 'P2022') throw e; }
    }

    // --- 6. Stale-rate warnings ---
    const staleRates = rates.filter((r) => r.stale).map((r) => `${r.from}→${r.to}`);

    res.json({
      baseCurrency,
      enabledCurrencies,
      migrated: { settings: settingsMigrated, exposure: exposureMigrated, rates: ratesMigrated, fx: fxMigrated, outstanding: outstandingMigrated },
      totals: {
        revenueMtd,
        expenseMtd,
        outstanding,
        netMtd: revenueMtd - expenseMtd,
        fxGainMtd,
        fxLossMtd,
        fxNetMtd: fxGainMtd - fxLossMtd,
      },
      exposure,
      rates,
      staleRates,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { next(e); }
});

module.exports = router;
