// Phase 35 Track 4/10: Revenue Projections — projected revenue per month from
// active contracts + recurring invoices + sales pipeline (leads).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

const MONTH_MS = 86400000;

function monthKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

function monthLabel(y, m) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m]} ${String(y).slice(2)}`;
}

function startOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 1));
}

function endOfMonth(y, m) {
  return new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
}

function advanceByFrequency(date, frequency) {
  const d = new Date(date);
  if (frequency === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1); // monthly (default)
  return d;
}

router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 1), 24);

    const now = new Date();
    const horizonStart = startOfMonth(now.getUTCFullYear(), now.getUTCMonth());
    const horizonEnd = endOfMonth(
      now.getUTCFullYear(),
      now.getUTCMonth() + months - 1
    );

    // Buckets: one per month in the horizon.
    const buckets = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      buckets.push({
        key: monthKey(y, m),
        label: monthLabel(y, m),
        start: startOfMonth(y, m),
        end: endOfMonth(y, m),
        contracts: 0,
        recurring: 0,
        pipeline: 0,
        total: 0,
      });
    }
    const bucketFor = (date) => {
      const d = new Date(date);
      const key = monthKey(d.getUTCFullYear(), d.getUTCMonth());
      return buckets.find((b) => b.key === key) || null;
    };

    // 1) Active contracts — rentAmount is the MONTHLY rent.
    const contracts = await prisma.contract.findMany({
      where: { ...tf, status: 'active' },
      select: { id: true, rentAmount: true, startDate: true, endDate: true },
    });
    for (const c of contracts) {
      const rent = Number(c.rentAmount) || 0;
      if (rent <= 0) continue;
      const cStart = new Date(c.startDate);
      const cEnd = c.endDate ? new Date(c.endDate) : null;
      for (const b of buckets) {
        if (cStart <= b.end && (!cEnd || cEnd >= b.start)) b.contracts += rent;
      }
    }

    // 2) Recurring invoices — active schedules fire on their frequency.
    const recurring = await prisma.recurringInvoice.findMany({
      where: { ...tf, status: 'active' },
      select: {
        id: true,
        amount: true,
        frequency: true,
        startDate: true,
        endDate: true,
        nextRunAt: true,
      },
    });
    for (const r of recurring) {
      const amount = Number(r.amount) || 0;
      if (amount <= 0) continue;
      const rEnd = r.endDate ? new Date(r.endDate) : null;
      let run = new Date(r.nextRunAt);
      // Align past-due schedules to the horizon start.
      let guard = 0;
      while (run < horizonStart && guard < 120) {
        run = advanceByFrequency(run, r.frequency);
        guard += 1;
      }
      guard = 0;
      while (run <= horizonEnd && guard < 60) {
        if (!rEnd || run <= rEnd) {
          const b = bucketFor(run);
          if (b) b.recurring += amount;
        }
        run = advanceByFrequency(run, r.frequency);
        guard += 1;
      }
    }

    // 3) Pipeline — open leads' budgets x conversion rate, spread evenly.
    const openLeads = await prisma.lead.findMany({
      where: {
        ...tf,
        stage: { in: ['new', 'contacted', 'visit'] },
        convertedMemberId: null,
        budget: { not: null },
      },
      select: { id: true, budget: true, stage: true },
    });
    let conversionRate = 0.25;
    try {
      const setting = await prisma.setting.findFirst({
        where: { ...tf, key: 'pipelineConversionRate' },
        select: { value: true },
      });
      if (setting && setting.value != null) {
        const v = parseFloat(setting.value);
        if (!Number.isNaN(v) && v >= 0 && v <= 1) conversionRate = v;
      }
    } catch (e) {
      // Setting model/table differences across installs — keep default.
    }
    const pipelineTotal = openLeads.reduce(
      (sum, l) => sum + (Number(l.budget) || 0),
      0
    ) * conversionRate;
    const pipelinePerMonth = months > 0 ? pipelineTotal / months : 0;
    for (const b of buckets) b.pipeline = pipelinePerMonth;

    // Totals.
    const breakdown = { contracts: 0, recurring: 0, pipeline: 0 };
    for (const b of buckets) {
      b.total = b.contracts + b.recurring + b.pipeline;
      breakdown.contracts += b.contracts;
      breakdown.recurring += b.recurring;
      breakdown.pipeline += b.pipeline;
    }
    const total = breakdown.contracts + breakdown.recurring + breakdown.pipeline;

    const byMonth = buckets.map((b) => ({
      month: b.key,
      label: b.label,
      contracts: Math.round(b.contracts * 100) / 100,
      recurring: Math.round(b.recurring * 100) / 100,
      pipeline: Math.round(b.pipeline * 100) / 100,
      total: Math.round(b.total * 100) / 100,
    }));

    return res.json({
      months,
      byMonth,
      total: Math.round(total * 100) / 100,
      breakdown: {
        contracts: Math.round(breakdown.contracts * 100) / 100,
        recurring: Math.round(breakdown.recurring * 100) / 100,
        pipeline: Math.round(breakdown.pipeline * 100) / 100,
      },
      counts: {
        activeContracts: contracts.length,
        activeRecurringInvoices: recurring.length,
        openLeads: openLeads.length,
        conversionRate,
      },
      assumptions: [
        'Contract rentAmount is treated as monthly rent.',
        'Recurring invoices project from their next run date on their billing frequency.',
        'Pipeline = open leads (new/contacted/visit) with a budget × conversion rate, spread evenly across the horizon.',
      ],
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
