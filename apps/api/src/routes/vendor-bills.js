// Phase 41 Track 4: Vendor Bills — CRUD, approve (auto expense), dispute, pay, overdue.
// Mount (coordinator): app.use('/api/vendor-bills', require('./routes/vendor-bills'));
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

const FINANCE_ROLES = ['ceo', 'admin', 'super_admin', 'finance'];
const financeOnly = requireRole(...FINANCE_ROLES);
const STATUSES = ['pending', 'approved', 'paid', 'disputed'];

// Vendor.category -> Expense.category mapping (Expense model categories:
// rent_building | utilities | internet | cleaning | kitchen | maintenance |
// marketing | salaries | petty_cash | other)
const EXPENSE_CATEGORY_FOR_VENDOR = {
  maintenance: 'maintenance',
  food: 'kitchen',
  it: 'internet',
  office: 'other',
  other: 'other',
};

const billSchema = z.object({
  billNo: z.string().min(1).max(100),
  vendorId: z.string().min(1),
  poId: z.string().min(1).optional().nullable(),
  grnId: z.string().min(1).optional().nullable(),
  amount: z.number().positive(),
  dueDate: z.string().min(1), // ISO date
  notes: z.string().max(5000).optional().default(''),
});

function missingSchema(req, res, next) {
  if (typeof prisma.vendorBill === 'undefined') {
    return res.status(503).json({ error: { message: 'Vendor bills schema not merged yet. Deploy pending.' } });
  }
  next();
}

const INCLUDE = {
  vendor: { select: { id: true, name: true, company: true, category: true } },
  purchaseOrder: { select: { id: true, number: true, total: true, status: true } },
  goodsReceipt: { select: { id: true, status: true, receivedAt: true } },
  approver: { select: { id: true, name: true } },
};

// 3-way match: PO <-> GRN <-> Bill
function threeWayMatch(bill) {
  const po = bill.purchaseOrder || null;
  const grn = bill.goodsReceipt || null;
  const poLink = po ? 'linked' : 'no-po';
  const grnLink = grn ? 'received' : (po ? 'not-received' : 'no-po');
  let amountMatch = 'unknown';
  if (po) amountMatch = Math.abs(Number(po.total) - Number(bill.amount)) < 0.01 ? 'match' : 'mismatch';
  return { poLink, grnLink, amountMatch };
}

const withMatch = (bill) => ({ ...bill, match: threeWayMatch(bill) });
const isOverdue = (bill) => {
  if (!bill) return false;
  return ['pending', 'approved'].includes(bill.status) && new Date(bill.dueDate) < new Date(new Date().toDateString());
};

// List
router.get('/', financeOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status && STATUSES.includes(String(req.query.status))) where.status = req.query.status;
    if (req.query.vendorId) where.vendorId = String(req.query.vendorId);
    if (req.query.search) where.billNo = { contains: String(req.query.search), mode: 'insensitive' };
    let bills = await prisma.vendorBill.findMany({ where, include: INCLUDE, orderBy: { dueDate: 'asc' }, take: 200 });
    if (req.query.overdue === '1') bills = bills.filter(isOverdue);
    res.json({ bills: bills.map(withMatch) });
  } catch (e) { next(e); }
});

// Overdue bills (due date passed, still unpaid)
router.get('/overdue', financeOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const bills = await prisma.vendorBill.findMany({
      where: { ...tf, status: { in: ['pending', 'approved'] }, dueDate: { lt: new Date() } },
      include: INCLUDE, orderBy: { dueDate: 'asc' }, take: 200,
    });
    res.json({ bills: bills.map(withMatch) });
  } catch (e) { next(e); }
});

// Stats
router.get('/stats', financeOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const counts = await prisma.vendorBill.groupBy({ by: ['status'], where: tf, _count: { _all: true } });
    const overdue = await prisma.vendorBill.findMany({
      where: { ...tf, status: { in: ['pending', 'approved'] }, dueDate: { lt: new Date() } },
      select: { amount: true },
    });
    const outstanding = await prisma.vendorBill.aggregate({
      where: { ...tf, status: { in: ['pending', 'approved'] } }, _sum: { amount: true },
    });
    res.json({
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      overdueCount: overdue.length,
      overdueValue: overdue.reduce((s, b) => s + Number(b.amount), 0),
      outstanding: Number(outstanding._sum.amount || 0),
    });
  } catch (e) { next(e); }
});

// Get one
router.get('/:id', financeOnly, missingSchema, async (req, res, next) => {
  try {
    const bill = await prisma.vendorBill.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) }, include: INCLUDE,
    });
    if (!bill) return res.status(404).json({ error: { message: 'Vendor bill not found' } });
    res.json({ bill: withMatch(bill) });
  } catch (e) { next(e); }
});

// Create
router.post('/', financeOnly, missingSchema, validateBody(billSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { billNo, vendorId, poId, grnId, amount, dueDate, notes } = req.body;
    const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, ...tf } });
    if (!vendor) return res.status(404).json({ error: { message: 'Vendor not found' } });
    if (poId) {
      const po = await prisma.purchaseOrder.findFirst({ where: { id: poId, ...tf } });
      if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
    }
    if (grnId && typeof prisma.goodsReceipt !== 'undefined') {
      const grn = await prisma.goodsReceipt.findFirst({ where: { id: grnId, ...tf } });
      if (!grn) return res.status(404).json({ error: { message: 'Goods receipt not found' } });
    }
    const bill = await prisma.vendorBill.create({
      data: {
        tenantId: tf.tenantId, billNo: billNo.trim(), vendorId: vendor.id,
        poId: poId || null, grnId: grnId || null, amount,
        dueDate: new Date(dueDate), status: 'pending', notes: notes || null,
      },
      include: INCLUDE,
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'vendor_bill.create', entity: 'VendorBill', entityId: bill.id, newValue: { billNo, amount }, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.status(201).json({ bill: withMatch(bill) });
  } catch (e) { next(e); }
});

// Update (pending/disputed only)
router.patch('/:id', financeOnly, missingSchema, validateBody(billSchema.partial()), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.vendorBill.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: { message: 'Vendor bill not found' } });
    if (!['pending', 'disputed'].includes(existing.status)) {
      return res.status(400).json({ error: { message: 'Only pending or disputed bills can be edited' } });
    }
    const { billNo, vendorId, poId, grnId, amount, dueDate, notes } = req.body;
    if (vendorId) {
      const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, ...tf } });
      if (!vendor) return res.status(404).json({ error: { message: 'Vendor not found' } });
    }
    const data = {};
    if (billNo !== undefined) data.billNo = String(billNo).trim();
    if (vendorId !== undefined) data.vendorId = vendorId;
    if (poId !== undefined) data.poId = poId || null;
    if (grnId !== undefined) data.grnId = grnId || null;
    if (amount !== undefined) data.amount = Number(amount);
    if (dueDate !== undefined) data.dueDate = new Date(dueDate);
    if (notes !== undefined) data.notes = notes || null;
    const bill = await prisma.vendorBill.update({ where: { id: existing.id }, data, include: INCLUDE });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'vendor_bill.update', entity: 'VendorBill', entityId: bill.id, newValue: { amount: String(bill.amount) }, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ bill: withMatch(bill) });
  } catch (e) { next(e); }
});

// Approve -> auto-create approved Expense entry (idempotent: expenseId set hone par dobara nahi banti)
router.post('/:id/approve', financeOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const bill = await prisma.vendorBill.findFirst({
      where: { id: req.params.id, ...tf }, include: INCLUDE,
    });
    if (!bill) return res.status(404).json({ error: { message: 'Vendor bill not found' } });
    if (!['pending', 'disputed'].includes(bill.status)) {
      return res.status(400).json({ error: { message: `Only pending or disputed bills can be approved (current: ${bill.status})` } });
    }
    let expenseId = bill.expenseId;
    let expenseSkipped = false;
    if (!expenseId) {
      if (typeof prisma.expense === 'undefined') {
        expenseSkipped = true;
      } else {
        const expense = await prisma.expense.create({
          data: {
            tenantId: tf.tenantId,
            category: EXPENSE_CATEGORY_FOR_VENDOR[bill.vendor.category] || 'other',
            amount: bill.amount,
            date: new Date(),
            paidBy: req.user.name || req.user.email || 'finance',
            note: `Vendor bill ${bill.billNo} — ${bill.vendor.company || bill.vendor.name}`,
            createdById: req.user.sub,
            status: 'approved',
            reviewedBy: req.user.sub,
            reviewedAt: new Date(),
            reviewNote: `Approved vendor bill ${bill.billNo}`,
          },
        });
        expenseId = expense.id;
      }
    }
    const updated = await prisma.vendorBill.update({
      where: { id: bill.id },
      data: { status: 'approved', approvedBy: req.user.sub, disputeReason: null, expenseId },
      include: INCLUDE,
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'vendor_bill.approve', entity: 'VendorBill', entityId: bill.id, newValue: { status: 'approved', expenseId }, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ bill: withMatch(updated), expenseCreated: !!expenseId && !expenseSkipped, expenseSkipped });
  } catch (e) { next(e); }
});

// Dispute
router.post('/:id/dispute', financeOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: { message: 'Dispute reason is required' } });
    }
    const bill = await prisma.vendorBill.findFirst({ where: { id: req.params.id, ...tf } });
    if (!bill) return res.status(404).json({ error: { message: 'Vendor bill not found' } });
    if (bill.status === 'paid') {
      return res.status(400).json({ error: { message: 'Paid bills cannot be disputed' } });
    }
    const updated = await prisma.vendorBill.update({
      where: { id: bill.id }, data: { status: 'disputed', disputeReason: String(reason).trim() }, include: INCLUDE,
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'vendor_bill.dispute', entity: 'VendorBill', entityId: bill.id, newValue: { status: 'disputed' }, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ bill: withMatch(updated) });
  } catch (e) { next(e); }
});

// Mark as paid
router.post('/:id/pay', financeOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const bill = await prisma.vendorBill.findFirst({ where: { id: req.params.id, ...tf } });
    if (!bill) return res.status(404).json({ error: { message: 'Vendor bill not found' } });
    if (bill.status !== 'approved') {
      return res.status(400).json({ error: { message: 'Only approved bills can be marked as paid' } });
    }
    const paidAt = req.body && req.body.paidAt ? new Date(req.body.paidAt) : new Date();
    const updated = await prisma.vendorBill.update({
      where: { id: bill.id }, data: { status: 'paid', paidAt }, include: INCLUDE,
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'vendor_bill.pay', entity: 'VendorBill', entityId: bill.id, newValue: { status: 'paid' }, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ bill: withMatch(updated) });
  } catch (e) { next(e); }
});

// Delete (pending/disputed only)
router.delete('/:id', financeOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const bill = await prisma.vendorBill.findFirst({ where: { id: req.params.id, ...tf } });
    if (!bill) return res.status(404).json({ error: { message: 'Vendor bill not found' } });
    if (!['pending', 'disputed'].includes(bill.status)) {
      return res.status(400).json({ error: { message: 'Only pending or disputed bills can be deleted' } });
    }
    await prisma.vendorBill.delete({ where: { id: bill.id } });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'vendor_bill.delete', entity: 'VendorBill', entityId: bill.id, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
