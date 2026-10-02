const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

// Staff money matters: ceo / admin / finance_officer only.
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'finance_officer'));

const num = (v) => Number(v);

const expenseSchema = z.object({
  category: z.string().min(1),
  amount: z.number().positive(),
  date: z.coerce.date(),
  paidBy: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});
const expenseUpdateSchema = z
  .object({
    category: z.string().min(1).optional(),
    amount: z.number().positive().optional(),
    date: z.coerce.date().optional(),
    paidBy: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

router.get('/expenses', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.month) {
      const m = String(req.query.month).match(/^(\d{4})-(\d{2})$/);
      if (m) {
        where.date = {
          gte: new Date(Number(m[1]), Number(m[2]) - 1, 1),
          lt: new Date(Number(m[1]), Number(m[2]), 1),
        };
      }
    }
    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
    });
    return res.json({ expenses });
  } catch (err) {
    return next(err);
  }
});

router.post('/expenses', validateBody(expenseSchema), async (req, res, next) => {
  try {
    const expense = await prisma.expense.create({
      data: { ...tenantFilter(req), ...req.body, createdById: req.user.sub },
    });
    return res.status(201).json({ expense });
  } catch (err) {
    return next(err);
  }
});

router.patch('/expenses/:id', validateBody(expenseUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.expense.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Expense not found' } });
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: req.body,
    });
    return res.json({ expense });
  } catch (err) {
    return next(err);
  }
});

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const existing = await prisma.expense.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Expense not found' } });
    await prisma.expense.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

// P&L for a month: income = cash collected (payments.paidAt in month),
// expenses = recorded expenses (date in month).
router.get('/pnl', async (req, res, next) => {
  try {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    if (req.query.month) {
      const m = String(req.query.month).match(/^(\d{4})-(\d{2})$/);
      if (!m) return res.status(400).json({ error: { message: 'month must be YYYY-MM' } });
      year = Number(m[1]);
      month = Number(m[2]);
    }
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const payments = await prisma.payment.findMany({
      where: { ...tenantFilter(req), paidAt: { gte: start, lt: end } },
      select: { amount: true },
    });
    const expenses = await prisma.expense.findMany({
      where: { ...tenantFilter(req), date: { gte: start, lt: end } },
      select: { amount: true, category: true },
    });

    const income = payments.reduce((s, p) => s + num(p.amount), 0);
    const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
    const byCategory = {};
    for (const e of expenses) {
      byCategory[e.category] = (byCategory[e.category] || 0) + num(e.amount);
    }

    return res.json({
      month: `${year}-${String(month).padStart(2, '0')}`,
      income,
      expenses: totalExpenses,
      byCategory,
      net: income - totalExpenses,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
