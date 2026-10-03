const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

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
    if (req.query.status && ['pending', 'approved', 'rejected'].includes(String(req.query.status))) {
      where.status = String(req.query.status);
    }
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
      data: { ...tenantFilter(req), ...req.body, status: 'pending', createdById: req.user.sub },
    });
    writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'expense.created',
      entity: 'Expense',
      entityId: expense.id,
      newValue: { category: expense.category, amount: String(expense.amount) },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    // Notify approvers (ceo + admin roles) about the new pending expense
    for (const role of ['ceo', 'admin']) {
      prisma.notification.create({
        data: {
          tenantId: req.user.tenantId,
          role,
          type: 'general',
          message: `New expense pending approval: ${expense.category} — Rs ${Number(expense.amount).toLocaleString()}`,
        },
      }).catch(() => {});
    }
    return res.status(201).json({ expense });
  } catch (err) {
    return next(err);
  }
});

// Approve / reject workflow (router already restricted to ceo/admin/finance_officer)
const reviewSchema = z.object({ note: z.string().max(500).optional().nullable() });

async function reviewExpense(req, res, next, decision) {
  try {
    const { note } = req.body || {};
    if (decision === 'rejected' && !note) {
      return res.status(400).json({ error: { message: 'A rejection note is required.' } });
    }
    const existing = await prisma.expense.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Expense not found' } });
    if (existing.status !== 'pending') {
      return res.status(400).json({ error: { message: `Expense is already ${existing.status}.` } });
    }
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: {
        status: decision,
        reviewedBy: req.user.sub,
        reviewedAt: new Date(),
        reviewNote: note || null,
      },
    });
    writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: `expense.${decision}`,
      entity: 'Expense',
      entityId: expense.id,
      oldValue: { status: 'pending' },
      newValue: { status: decision, reviewNote: note || null },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    // Notify the requester
    if (existing.createdById && existing.createdById !== req.user.sub) {
      prisma.notification.create({
        data: {
          tenantId: req.user.tenantId,
          userId: existing.createdById,
          type: 'general',
          message: `Your expense (${expense.category} — Rs ${Number(expense.amount).toLocaleString()}) was ${decision}${note ? `: ${note}` : ''}`,
        },
      }).catch(() => {});
    }
    return res.json({ expense });
  } catch (err) {
    return next(err);
  }
}

router.post('/expenses/:id/approve', validateBody(reviewSchema), (req, res, next) =>
  reviewExpense(req, res, next, 'approved')
);
router.post('/expenses/:id/reject', validateBody(reviewSchema), (req, res, next) =>
  reviewExpense(req, res, next, 'rejected')
);

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
// Alias: frontend sends PUT for edits
router.put('/expenses/:id', validateBody(expenseUpdateSchema), async (req, res, next) => {
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
