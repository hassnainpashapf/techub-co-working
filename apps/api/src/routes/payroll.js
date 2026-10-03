// Phase 31 Track 1: Payroll — salary structures, payroll runs, payslips.
const express = require('express');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const PAYROLL_ROLES = ['ceo', 'admin', 'super_admin', 'finance_officer'];
const payrollWrite = requireRole(...PAYROLL_ROLES);
const payrollRead = requireRole(...PAYROLL_ROLES);

const RUN_STATUSES = ['draft', 'finalized', 'paid'];

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'Payroll',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

function sumJson(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.values(obj).reduce((s, v) => s + (Number(v) || 0), 0);
}

const structureSchema = z.object({
  userId: z.string().min(1),
  basicSalary: z.number().nonnegative(),
  allowances: z.record(z.number().nonnegative()).optional().default({}),
  deductions: z.record(z.number().nonnegative()).optional().default({}),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

// List salary structures (latest per user first)
router.get('/structures', payrollRead, async (req, res, next) => {
  try {
    const structures = await prisma.salaryStructure.findMany({
      where: { ...tenantFilter(req) },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ effectiveFrom: 'desc' }],
      take: 200,
    });
    res.json({ structures });
  } catch (e) { next(e); }
});

// Create / update salary structure for a user
router.post('/structures', payrollWrite, validateBody(structureSchema), async (req, res, next) => {
  try {
    const { userId, basicSalary, allowances, deductions, effectiveFrom } = req.body;
    const user = await prisma.user.findFirst({
      where: { id: userId, ...tenantFilter(req) },
    });
    if (!user) return res.status(404).json({ error: { message: 'User not found in this tenant.' } });
    const structure = await prisma.salaryStructure.upsert({
      where: { userId_effectiveFrom: { userId, effectiveFrom: new Date(effectiveFrom) } },
      create: {
        tenantId: req.user.tenantId,
        userId,
        basicSalary: new Prisma.Decimal(basicSalary),
        allowances: allowances || {},
        deductions: deductions || {},
        effectiveFrom: new Date(effectiveFrom),
      },
      update: {
        basicSalary: new Prisma.Decimal(basicSalary),
        allowances: allowances || {},
        deductions: deductions || {},
      },
    });
    audit(req, 'payroll.structure_set', structure.id, { userId, basicSalary });
    res.status(201).json({ structure });
  } catch (e) { next(e); }
});

// List payroll runs
router.get('/runs', payrollRead, async (req, res, next) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      where: { ...tenantFilter(req) },
      include: { _count: { select: { payslips: true } } },
      orderBy: [{ month: 'desc' }],
    });
    res.json({ runs });
  } catch (e) { next(e); }
});

// Run detail with payslips
router.get('/runs/:id', payrollRead, async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: {
        payslips: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) return res.status(404).json({ error: { message: 'Payroll run not found.' } });
    res.json({ run });
  } catch (e) { next(e); }
});

const runSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
});

// Generate a payroll run (draft) for a month
router.post('/runs', payrollWrite, validateBody(runSchema), async (req, res, next) => {
  try {
    const { month } = req.body;
    const existing = await prisma.payrollRun.findFirst({
      where: { month, ...tenantFilter(req) },
    });
    if (existing) return res.status(400).json({ error: { message: `Payroll run for ${month} already exists.` } });

    const monthStart = new Date(`${month}-01T00:00:00.000Z`);
    // Latest effective structure per active user
    const structures = await prisma.salaryStructure.findMany({
      where: { ...tenantFilter(req), effectiveFrom: { lte: monthStart } },
      include: { user: { select: { id: true, name: true, isActive: true } } },
      orderBy: [{ effectiveFrom: 'desc' }],
    });
    const latestByUser = new Map();
    for (const s of structures) {
      if (!latestByUser.has(s.userId) && s.user.isActive) latestByUser.set(s.userId, s);
    }
    if (latestByUser.size === 0) {
      return res.status(400).json({ error: { message: 'No active salary structures found for this month.' } });
    }

    let total = new Prisma.Decimal(0);
    const payslipRows = [];
    for (const s of latestByUser.values()) {
      const basic = Number(s.basicSalary);
      const allow = sumJson(s.allowances);
      const ded = sumJson(s.deductions);
      const gross = basic + allow;
      const net = Math.max(0, gross - ded);
      total = total.plus(net);
      payslipRows.push({
        userId: s.userId,
        grossSalary: new Prisma.Decimal(gross),
        totalDeductions: new Prisma.Decimal(ded),
        netPay: new Prisma.Decimal(net),
        details: { basic, allowances: s.allowances, deductions: s.deductions },
        status: 'pending',
      });
    }

    const run = await prisma.payrollRun.create({
      data: {
        tenantId: req.user.tenantId,
        month,
        status: 'draft',
        totalAmount: total,
        createdBy: req.user.sub,
        payslips: { create: payslipRows },
      },
      include: { _count: { select: { payslips: true } } },
    });
    audit(req, 'payroll.run_created', run.id, { month, payslips: payslipRows.length });
    res.status(201).json({ run });
  } catch (e) { next(e); }
});

// Finalize a draft run
router.post('/runs/:id/finalize', payrollWrite, async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!run) return res.status(404).json({ error: { message: 'Payroll run not found.' } });
    if (run.status !== 'draft') return res.status(400).json({ error: { message: 'Only draft runs can be finalized.' } });
    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'finalized', finalizedAt: new Date() },
    });
    audit(req, 'payroll.run_finalized', run.id, { month: run.month });
    res.json({ run: updated });
  } catch (e) { next(e); }
});

// Mark a finalized run as paid (+ auto-create salary expense entries)
router.post('/runs/:id/mark-paid', payrollWrite, async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { payslips: { include: { user: { select: { name: true } } } } },
    });
    if (!run) return res.status(404).json({ error: { message: 'Payroll run not found.' } });
    if (run.status !== 'finalized') {
      return res.status(400).json({ error: { message: 'Only finalized runs can be marked paid.' } });
    }
    const today = new Date();
    await prisma.$transaction([
      prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'paid' } }),
      prisma.payslip.updateMany({ where: { payrollRunId: run.id }, data: { status: 'paid' } }),
      ...run.payslips.map((p) =>
        prisma.expense.create({
          data: {
            tenantId: run.tenantId,
            category: 'salaries',
            amount: p.netPay,
            date: today,
            note: `Payroll ${run.month} — ${p.user?.name || p.userId}`,
            createdById: req.user.sub,
            status: 'approved',
            reviewedBy: req.user.sub,
            reviewedAt: today,
          },
        })
      ),
    ]);
    audit(req, 'payroll.run_paid', run.id, { month: run.month, total: String(run.totalAmount) });
    const updated = await prisma.payrollRun.findUnique({ where: { id: run.id } });
    res.json({ run: updated });
  } catch (e) { next(e); }
});

module.exports = router;
