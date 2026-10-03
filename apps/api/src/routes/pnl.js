// Phase 35 Track 2: Investor P&L Report.
// Revenue = cash collected (payments on STANDARD invoices only — proforma
// invoices are quotes, never revenue) minus approved/processed refunds.
// Expenses = APPROVED expenses only, broken down by category.
// There is no OtherIncome model and invoices carry no category, so revenue is
// split into "Contract revenue" (invoices linked to a contract) and
// "Ad-hoc revenue" (standalone invoices). No COGS is tracked, so gross profit
// equals total revenue; this is documented in the response assumptions.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round(num(v) * 100) / 100;

function range(field, from, to) {
  const w = {};
  if (from || to) {
    w[field] = {};
    if (from) w[field].gte = new Date(`${from}T00:00:00`);
    if (to) w[field].lte = new Date(`${to}T23:59:59`);
  }
  return w;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(from, to) {
  const months = [];
  const start = new Date(from);
  const end = new Date(to);
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    months.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

async function computePnl(req, from, to) {
  const tf = tenantFilter(req);

  const [payments, refunds, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: { ...tf, ...range('paidAt', from, to) },
      select: {
        amount: true,
        paidAt: true,
        invoice: { select: { invoiceType: true, contractId: true } },
      },
    }),
    prisma.refund.findMany({
      where: {
        ...tf,
        status: { in: ['approved', 'processed'] },
        ...range('createdAt', from, to),
      },
      select: {
        amount: true,
        createdAt: true,
        payment: { select: { invoice: { select: { invoiceType: true } } } },
      },
    }),
    prisma.expense.findMany({
      where: { ...tf, status: 'approved', ...range('date', from, to) },
      select: { amount: true, category: true, date: true },
    }),
  ]);

  // Revenue: cash basis, standard invoices only (proforma excluded).
  let contractRevenue = 0;
  let adhocRevenue = 0;
  const monthly = new Map();

  const bucket = (dateLike) => {
    const k = monthKey(new Date(dateLike));
    if (!monthly.has(k)) monthly.set(k, { month: k, revenue: 0, expenses: 0, profit: 0 });
    return monthly.get(k);
  };

  for (const p of payments) {
    if (!p.invoice || p.invoice.invoiceType !== 'standard') continue; // proforma = not revenue
    const amt = num(p.amount);
    if (p.invoice.contractId) contractRevenue += amt;
    else adhocRevenue += amt;
    bucket(p.paidAt).revenue += amt;
  }

  let refundsTotal = 0;
  for (const r of refunds) {
    if (r.payment && r.payment.invoice && r.payment.invoice.invoiceType !== 'standard') continue;
    const amt = num(r.amount);
    refundsTotal += amt;
    bucket(r.createdAt).revenue -= amt;
  }

  const expensesByCategory = {};
  let expensesTotal = 0;
  for (const e of expenses) {
    const amt = num(e.amount);
    const cat = e.category || 'other';
    expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amt;
    expensesTotal += amt;
    bucket(e.date).expenses += amt;
  }

  const totalRevenue = contractRevenue + adhocRevenue - refundsTotal;
  const grossProfit = totalRevenue; // no COGS tracked
  const netProfit = totalRevenue - expensesTotal;
  const marginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  const months = monthRange(from, to).map((k) => {
    const m = monthly.get(k) || { month: k, revenue: 0, expenses: 0, profit: 0 };
    m.profit = m.revenue - m.expenses;
    return {
      month: m.month,
      revenue: r2(m.revenue),
      expenses: r2(m.expenses),
      profit: r2(m.profit),
    };
  });

  const catLines = Object.entries(expensesByCategory)
    .map(([category, amount]) => ({ category, amount: r2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    from,
    to,
    assumptions: [
      'Revenue is cash-basis: payments received on standard invoices only.',
      'Proforma invoices are excluded — they are quotes, not revenue.',
      'Only approved expenses are counted; pending/rejected are excluded.',
      'No COGS is tracked, so gross profit equals total revenue.',
      'No OtherIncome model exists yet, so revenue comes only from invoices.',
    ],
    revenue: {
      contract: r2(contractRevenue),
      adhoc: r2(adhocRevenue),
      refunds: r2(refundsTotal),
      total: r2(totalRevenue),
    },
    expenses: {
      byCategory: catLines,
      total: r2(expensesTotal),
    },
    grossProfit: r2(grossProfit),
    netProfit: r2(netProfit),
    marginPct: r2(marginPct),
    monthly: months,
  };
}

function defaultRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-01-01`;
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

// GET /api/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', async (req, res, next) => {
  try {
    const d = defaultRange();
    const from = req.query.from || d.from;
    const to = req.query.to || d.to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: { message: 'from/to must be YYYY-MM-DD' } });
    }
    const data = await computePnl(req, from, to);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

// GET /api/pnl/export?from=&to= — CSV download
router.get('/export', async (req, res, next) => {
  try {
    const d = defaultRange();
    const from = req.query.from || d.from;
    const to = req.query.to || d.to;
    const data = await computePnl(req, from, to);

    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const f = (v) => r2(v).toFixed(2);
    const row = (a, b, c) => [esc(a), esc(b), c].join(',');
    const lines = ['﻿' + row('Section', 'Line', 'Amount')];
    lines.push(row('Revenue', 'Contract revenue', f(data.revenue.contract)));
    lines.push(row('Revenue', 'Ad-hoc revenue', f(data.revenue.adhoc)));
    lines.push(row('Revenue', 'Less: refunds', f(-data.revenue.refunds)));
    lines.push(row('Revenue', 'Total revenue', f(data.revenue.total)));
    for (const c of data.expenses.byCategory) {
      lines.push(row('Expenses', `Expense: ${c.category}`, f(c.amount)));
    }
    lines.push(row('Expenses', 'Total expenses', f(data.expenses.total)));
    lines.push(row('Profit', 'Gross profit', f(data.grossProfit)));
    lines.push(row('Profit', 'Net profit', f(data.netProfit)));
    lines.push(row('Profit', 'Net margin %', data.marginPct.toFixed(2)));
    lines.push('');
    lines.push(['Monthly', 'Month', 'Revenue', 'Expenses', 'Profit'].map(esc).join(','));
    for (const m of data.monthly) {
      lines.push([esc('Monthly'), esc(m.month), f(m.revenue), f(m.expenses), f(m.profit)].join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pnl-${from}-to-${to}.csv"`
    );
    return res.send(lines.join('\n'));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
