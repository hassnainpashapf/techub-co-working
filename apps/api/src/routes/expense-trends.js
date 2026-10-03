// Phase 35 Track 6: Expense Trend Analytics.
// NOTE: Only `approved` expenses count as real spend (rejected/pending excluded,
// same convention as budgets actuals).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'finance_officer'));

const num = (v) => Number(v) || 0;

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(k) {
  const [y, m] = k.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en', { month: 'short' });
}

// GET /api/expense-trends?months=12
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    let months = parseInt(req.query.months, 10) || 12;
    months = Math.min(Math.max(months, 1), 24);

    const now = new Date();
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push(monthKey(d));
    }
    const fromDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

    const expenses = await prisma.expense.findMany({
      where: { ...tf, status: 'approved', date: { gte: fromDate } },
      select: { category: true, amount: true, date: true },
    });

    const cats = [...new Set(expenses.map((e) => e.category))].sort();
    const matrix = {};
    for (const c of cats) matrix[c] = buckets.map(() => 0);
    for (const e of expenses) {
      const k = monthKey(new Date(e.date));
      const idx = buckets.indexOf(k);
      if (idx >= 0) matrix[e.category][idx] += num(e.amount);
    }

    const totals = {};
    let grandTotal = 0;
    for (const c of cats) {
      totals[c] = matrix[c].reduce((a, b) => a + b, 0);
      grandTotal += totals[c];
    }

    // MoM %: last month vs previous month
    const mom = {};
    for (const c of cats) {
      const last = matrix[c][months - 1];
      const prev = months > 1 ? matrix[c][months - 2] : 0;
      mom[c] = prev > 0 ? ((last - prev) / prev) * 100 : null;
    }

    const topGrowing = cats
      .filter((c) => mom[c] !== null && mom[c] > 0)
      .map((c) => ({ category: c, pct: mom[c] }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);

    // Anomaly: month value >= 2x average of prior 3 months (ignore tiny noise)
    const anomalies = [];
    for (const c of cats) {
      for (let i = 3; i < months; i++) {
        const v = matrix[c][i];
        if (v < 1000) continue;
        const prior = matrix[c].slice(i - 3, i);
        const avg = prior.reduce((a, b) => a + b, 0) / 3;
        if (avg > 0 && v >= 2 * avg) {
          anomalies.push({ category: c, month: buckets[i], amount: v, priorAvg: Math.round(avg), spike: +(v / avg).toFixed(1) });
        }
      }
    }
    anomalies.sort((a, b) => b.spike - a.spike);

    res.json({
      months: buckets,
      monthLabels: buckets.map(monthLabel),
      categories: cats,
      matrix,
      totals,
      grandTotal,
      mom,
      topGrowing,
      anomalies,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
