// Phase 42 Track 6: Salary Advances & Loans.
// Mount: /api/advances (coordinator). Sidebar: HR section -> { label: 'Advances & Loans', path: '/hr/advances' }.
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

const HR_ROLES = ['ceo', 'admin', 'super_admin'];
const hrOnly = requireRole(...HR_ROLES);

function advancesEnabled() {
  return !!(prisma && prisma.salaryAdvance);
}
function guard503(req, res, next) {
  if (!advancesEnabled()) return res.status(503).json({ error: 'Advances schema pending migration' });
  next();
}
router.use(guard503);

const TYPES = ['advance', 'loan'];
const STATUSES = ['pending', 'approved', 'rejected', 'deducting', 'closed'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'SalaryAdvance', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// Logged-in user ka linked employee (Employee.userId). HR roles direct employeeId de sakte hain.
async function myEmployee(req) {
  if (!prisma.employee) return null;
  return prisma.employee.findFirst({
    where: { userId: req.user.sub, ...tenantFilter(req) },
  });
}

const requestSchema = z.object({
  amount: z.number().positive().max(100000000),
  type: z.enum(TYPES).default('advance'),
  installments: z.number().int().min(1).max(36).default(1),
  reason: z.string().max(400).optional().nullable(),
  employeeId: z.string().min(1).optional(), // HR manually kisi employee ke liye request bana sakta hai
});

// ---- Employee endpoints ----
router.post('/request', validateBody(requestSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { amount, type, installments, reason } = req.body;
    let employeeId = req.body.employeeId;
    if (employeeId) {
      // HR kisi aur ke liye — sirf HR roles
      if (!HR_ROLES.includes(req.user.role)) {
        return res.status(403).json({ error: 'Sirf HR doosre employee ke liye request bana sakta hai.' });
      }
      const emp = await prisma.employee.findFirst({ where: { id: employeeId, ...tf } });
      if (!emp) return res.status(404).json({ error: 'Employee nahi mila.' });
    } else {
      const me = await myEmployee(req);
      if (!me) return res.status(400).json({ error: 'Aapka employee profile linked nahi hai — HR se link karwao.' });
      employeeId = me.id;
    }
    if (type === 'advance' && installments !== 1) {
      return res.status(400).json({ error: 'Salary advance hamesha 1 installment me deduct hota hai.' });
    }
    const installmentAmount = Math.round((amount / installments) * 100) / 100;
    const adv = await prisma.salaryAdvance.create({
      data: {
        tenantId: tf.tenantId,
        employeeId,
        amount: new Prisma.Decimal(amount),
        type,
        installments,
        installmentAmount: new Prisma.Decimal(installmentAmount),
        deductedSoFar: new Prisma.Decimal(0),
        status: 'pending',
        reason: reason || null,
      },
      include: { employee: { select: { id: true, name: true } } },
    });
    audit(req, tf, 'advance.requested', adv.id, { amount, type, installments });
    res.status(201).json({ advance: adv });
  } catch (e) { next(e); }
});

router.get('/mine', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const me = await myEmployee(req);
    if (!me) return res.json({ advances: [], employee: null });
    const advances = await prisma.salaryAdvance.findMany({
      where: { ...tf, employeeId: me.id },
      include: { deductions: { orderBy: { deductedAt: 'desc' } } },
      orderBy: { requestedAt: 'desc' },
    });
    res.json({ advances, employee: { id: me.id, name: me.name } });
  } catch (e) { next(e); }
});

// ---- HR endpoints ----
router.get('/pending', hrOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const advances = await prisma.salaryAdvance.findMany({
      where: { ...tf, status: 'pending' },
      include: {
        employee: { select: { id: true, name: true, designation: true, department: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });
    res.json({ advances });
  } catch (e) { next(e); }
});

router.get('/', hrOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status && STATUSES.includes(req.query.status)) where.status = req.query.status;
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.type && TYPES.includes(req.query.type)) where.type = req.query.type;
    const advances = await prisma.salaryAdvance.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, designation: true, department: true } },
        deductions: { orderBy: { deductedAt: 'desc' } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 300,
    });
    res.json({ advances });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const adv = await prisma.salaryAdvance.findFirst({
      where: { id: req.params.id, ...tf },
      include: {
        employee: { select: { id: true, name: true, designation: true, department: true } },
        deductions: { orderBy: { deductedAt: 'desc' } },
      },
    });
    if (!adv) return res.status(404).json({ error: 'Request nahi mili.' });
    // Employee sirf apni dekh sakta hai
    if (!HR_ROLES.includes(req.user.role)) {
      const me = await myEmployee(req);
      if (!me || me.id !== adv.employeeId) return res.status(403).json({ error: 'Access denied.' });
    }
    res.json({ advance: adv });
  } catch (e) { next(e); }
});

const decideSchema = z.object({
  note: z.string().max(400).optional().nullable(),
});

router.post('/:id/approve', hrOnly, validateBody(decideSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const adv = await prisma.salaryAdvance.findFirst({ where: { id: req.params.id, ...tf } });
    if (!adv) return res.status(404).json({ error: 'Request nahi mili.' });
    if (adv.status !== 'pending') return res.status(400).json({ error: 'Sirf pending request approve ho sakti hai.' });
    const updated = await prisma.salaryAdvance.update({
      where: { id: adv.id },
      data: {
        status: 'approved',
        decidedById: req.user.sub,
        decidedAt: new Date(),
        decideNote: req.body.note || null,
      },
      include: { employee: { select: { id: true, name: true } } },
    });
    audit(req, tf, 'advance.approved', adv.id, { amount: Number(adv.amount), type: adv.type });
    res.json({ advance: updated });
  } catch (e) { next(e); }
});

router.post('/:id/reject', hrOnly, validateBody(decideSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const adv = await prisma.salaryAdvance.findFirst({ where: { id: req.params.id, ...tf } });
    if (!adv) return res.status(404).json({ error: 'Request nahi mili.' });
    if (adv.status !== 'pending') return res.status(400).json({ error: 'Sirf pending request reject ho sakti hai.' });
    const updated = await prisma.salaryAdvance.update({
      where: { id: adv.id },
      data: {
        status: 'rejected',
        decidedById: req.user.sub,
        decidedAt: new Date(),
        decideNote: req.body.note || null,
      },
      include: { employee: { select: { id: true, name: true } } },
    });
    audit(req, tf, 'advance.rejected', adv.id, { note: req.body.note });
    res.json({ advance: updated });
  } catch (e) { next(e); }
});

module.exports = router;
