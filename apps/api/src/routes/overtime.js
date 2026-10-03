// Phase 42 Track 4: Overtime Tracking API
// Mount: app.use('/api/overtime', require('./routes/overtime'));

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

// 503 guard: schema merge pending
router.use((req, res, next) => {
  if (!prisma.overtime) return res.status(503).json({ error: 'Overtime module not migrated yet' });
  next();
});

const MGMT = ['ceo', 'admin', 'super_admin', 'manager'];

// Resolve logged-in user's linked employee
async function myEmployee(req) {
  const tf = tenantFilter(req);
  return prisma.employee.findFirst({ where: { ...tf, userId: req.user.sub } });
}

const requestSchema = z.object({
  date: z.coerce.date(),
  minutes: z.number().int().min(15).max(720),
  reason: z.string().min(3).max(500),
});

// POST /request — employee submits overtime
router.post('/request', validateBody(requestSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const emp = await myEmployee(req);
    if (!emp) return res.status(404).json({ error: 'No linked employee profile' });
    if (emp.status !== 'active') return res.status(403).json({ error: 'Employee not active' });

    const { date, minutes, reason } = req.body;
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    if (d > new Date()) return res.status(400).json({ error: 'Future date not allowed' });

    const existing = await prisma.overtime.findUnique({
      where: { employeeId_date: { employeeId: emp.id, date: d } },
    });
    if (existing) return res.status(409).json({ error: 'Overtime already requested for this date' });

    const ot = await prisma.overtime.create({
      data: { ...tf, employeeId: emp.id, date: d, minutes, reason, status: 'pending' },
    });
    await writeAudit(req, 'overtime.request', 'Overtime', ot.id, { minutes, date: d });
    res.status(201).json({ overtime: ot });
  } catch (e) {
    res.status(500).json({ error: 'Request failed' });
  }
});

// GET /mine — my overtime history
router.get('/mine', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const emp = await myEmployee(req);
    if (!emp) return res.json({ overtime: [], totals: { pending: 0, approved: 0 } });
    const rows = await prisma.overtime.findMany({
      where: { ...tf, employeeId: emp.id },
      orderBy: { date: 'desc' },
      take: 100,
    });
    const totals = {
      pending: rows.filter(r => r.status === 'pending').reduce((s, r) => s + r.minutes, 0),
      approved: rows.filter(r => r.status === 'approved').reduce((s, r) => s + r.minutes, 0),
    };
    res.json({ overtime: rows, totals });
  } catch (e) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// GET /pending — manager approvals inbox
router.get('/pending', requireRole(MGMT), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const rows = await prisma.overtime.findMany({
      where: { ...tf, status: 'pending' },
      include: { employee: { select: { id: true, name: true, department: true } } },
      orderBy: { date: 'asc' },
    });
    res.json({ overtime: rows });
  } catch (e) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// GET / — all (manager), filters
router.get('/', requireRole(MGMT), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);
    if (req.query.month) {
      const [y, m] = String(req.query.month).split('-').map(Number);
      where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
    }
    const rows = await prisma.overtime.findMany({
      where,
      include: { employee: { select: { id: true, name: true, department: true } } },
      orderBy: { date: 'desc' },
      take: 200,
    });
    res.json({ overtime: rows });
  } catch (e) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// POST /:id/approve
router.post('/:id/approve', requireRole(MGMT), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const ot = await prisma.overtime.findFirst({ where: { id: req.params.id, ...tf } });
    if (!ot) return res.status(404).json({ error: 'Not found' });
    if (ot.status !== 'pending') return res.status(400).json({ error: `Already ${ot.status}` });

    const updated = await prisma.overtime.update({
      where: { id: ot.id },
      data: { status: 'approved', decidedBy: req.user.sub, decidedAt: new Date() },
    });
    await writeAudit(req, 'overtime.approve', 'Overtime', ot.id, { minutes: ot.minutes });
    res.json({ overtime: updated });
  } catch (e) {
    res.status(500).json({ error: 'Approve failed' });
  }
});

// POST /:id/reject
router.post('/:id/reject', requireRole(MGMT), validateBody(z.object({ note: z.string().max(500).optional() })), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const ot = await prisma.overtime.findFirst({ where: { id: req.params.id, ...tf } });
    if (!ot) return res.status(404).json({ error: 'Not found' });
    if (ot.status !== 'pending') return res.status(400).json({ error: `Already ${ot.status}` });

    const updated = await prisma.overtime.update({
      where: { id: ot.id },
      data: { status: 'rejected', decidedBy: req.user.sub, decidedAt: new Date() },
    });
    await writeAudit(req, 'overtime.reject', 'Overtime', ot.id, { note: req.body.note });
    res.json({ overtime: updated });
  } catch (e) {
    res.status(500).json({ error: 'Reject failed' });
  }
});

/**
 * PAYROLL INTEGRATION NOTE (coordinator):
 * Phase 31 payroll route (apps/api/src/routes/payroll.js) generates payslips from
 * SalaryStructure.basicSalary + allowances. To add approved overtime pay:
 *   1. On payroll run generation for month M, fetch:
 *      prisma.overtime.findMany({ where: { tenantId, status: 'approved',
 *        date: { gte: startOf(M), lt: startOf(M+1) } } })
 *   2. Per employee: hourlyRate = basicSalary / 160 (8h x 20 days). overtimePay = sum(minutes)/60 * hourlyRate * 1.5
 *   3. Add to payslip.details: { ..., overtime: { minutes, amount } } and add amount to grossSalary/netPay.
 *   4. Optionally store `payslip.details.overtimePaid: true` to avoid double-paying on re-run.
 */

module.exports = router;
