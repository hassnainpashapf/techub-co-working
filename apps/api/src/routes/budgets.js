// Phase 31 Track 8: Budgets (Budget vs Actual) per expense category per month.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const FINANCE_ROLES = ['ceo', 'admin', 'super_admin', 'finance_officer'];
const financeWrite = requireRole(...FINANCE_ROLES);

const CATEGORIES = [
  'rent_building', 'utilities', 'internet', 'cleaning', 'kitchen',
  'maintenance', 'marketing', 'salaries', 'petty_cash', 'other',
];

const monthRe = /^\d{4}-\d{2}$/;

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

// GET /?month=2026-10 — budgets + actuals + variance per category
router.get('/', financeWrite, async (req, res, next) => {
  try {
    const month = typeof req.query.month === 'string' && monthRe.test(req.query.month)
      ? req.query.month
      : new Date().toISOString().slice(0, 7);
    const tf = tenantFilter(req);

    const budgets = await prisma.budget.findMany({ where: { ...tf, month } });
    const budgetMap = Object.fromEntries(budgets.map((b) => [b.category, Number(b.amount)]));

    const { start, end } = monthRange(month);
    const actuals = await prisma.expense.groupBy({
      by: ['category'],
      where: { ...tf, date: { gte: start, lt: end }, status: { not: 'rejected' } },
      _sum: { amount: true },
    });
    const actualMap = Object.fromEntries(actuals.map((a) => [a.category, Number(a._sum.amount || 0)]));

    const rows = CATEGORIES.map((category) => {
      const budgeted = budgetMap[category] || 0;
      const actual = actualMap[category] || 0;
      const variance = budgeted - actual;
      const pct = budgeted > 0 ? Math.round((actual / budgeted) * 100) : null;
      return { category, budgeted, actual, variance, pct };
    });
    const totals = {
      budgeted: rows.reduce((s, r) => s + r.budgeted, 0),
      actual: rows.reduce((s, r) => s + r.actual, 0),
    };
    totals.variance = totals.budgeted - totals.actual;
    res.json({ month, categories: CATEGORIES, rows, totals });
  } catch (e) { next(e); }
});

// PUT / — {month, items: [{category, amount}]} upsert
const putSchema = z.object({
  month: z.string().regex(monthRe, 'month must be YYYY-MM'),
  items: z.array(z.object({
    category: z.string().min(1),
    amount: z.number().nonnegative(),
  })).min(1),
});

router.put('/', financeWrite, validateBody(putSchema), async (req, res, next) => {
  try {
    const { month, items } = req.body;
    const tf = tenantFilter(req);
    const invalid = items.filter((i) => !CATEGORIES.includes(i.category));
    if (invalid.length) {
      return res.status(400).json({ error: { message: `Invalid categories: ${invalid.map((i) => i.category).join(', ')}` } });
    }
    await prisma.$transaction(
      items.map((i) =>
        prisma.budget.upsert({
          where: { tenantId_month_category: { tenantId: req.user.tenantId, month, category: i.category } },
          update: { amount: i.amount },
          create: { tenantId: req.user.tenantId, month, category: i.category, amount: i.amount },
        })
      )
    );
    await writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'budget.upsert',
      entity: 'Budget',
      entityId: month,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ ok: true, month, count: items.length });
  } catch (e) { next(e); }
});

module.exports = router;
