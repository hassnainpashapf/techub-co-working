// Phase 41 Track 5: Vendor Payments & AP Aging.
// Record payments against vendor bills; vendor-wise aging buckets.
// Mount: /api/vendor-payments (coordinator).
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

const FINANCE = ['ceo', 'admin', 'super_admin', 'finance'];
const financeOnly = requireRole(...FINANCE);

function paymentsEnabled() {
  return !!(prisma && prisma.vendorPayment && prisma.vendorBill);
}
function guard503(req, res, next) {
  if (!paymentsEnabled()) return res.status(503).json({ error: 'Vendor payments schema pending migration' });
  next();
}
router.use(guard503);

const METHODS = ['bank', 'cash', 'online'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'VendorPayment', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const paySchema = z.object({
  billId: z.string().min(1),
  amount: z.number().positive().max(999999999),
  method: z.enum(METHODS).default('bank'),
  reference: z.string().max(120).optional().nullable(),
  paidAt: z.coerce.date().optional(),
});

// POST / — record a payment against a bill; updates bill paidAmount + status
router.post('/', financeOnly, validateBody(paySchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { billId, amount, method, reference, paidAt } = req.body;

    const bill = await prisma.vendorBill.findFirst({ where: { id: billId, ...tf } });
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.status === 'paid') return res.status(409).json({ error: 'Bill already fully paid' });
    if (bill.status === 'disputed') return res.status(409).json({ error: 'Bill is disputed — resolve dispute first' });

    const outstanding = Number(bill.amount) - Number(bill.paidAmount || 0);
    if (amount > outstanding + 0.005) {
      return res.status(422).json({ error: `Amount exceeds outstanding balance (${outstanding.toFixed(2)})` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.vendorPayment.create({
        data: {
          tenantId: tf.tenantId,
          billId: bill.id,
          amount,
          method,
          reference: reference || null,
          paidAt: paidAt || new Date(),
          paidById: req.user.sub,
        },
      });
      const newPaid = Number(bill.paidAmount || 0) + amount;
      const fullyPaid = newPaid >= Number(bill.amount) - 0.005;
      const updated = await tx.vendorBill.update({
        where: { id: bill.id },
        data: {
          paidAmount: newPaid,
          status: fullyPaid ? 'paid' : 'partial',
          paidAt: fullyPaid ? new Date() : bill.paidAt,
        },
      });
      return { payment, updated };
    });

    audit(req, tf, 'vendor_payment.record', result.payment.id, {
      billId, amount, method, newPaidAmount: result.updated.paidAmount,
    });
    res.status(201).json({
      ok: true,
      payment: result.payment,
      bill: { id: result.updated.id, status: result.updated.status, paidAmount: result.updated.paidAmount },
    });
  } catch (err) {
    console.error('vendor-payments POST / error:', err);
    res.status(500).json({ error: 'Payment failed' });
  }
});

// GET / — payment history (?billId=, ?vendorId=)
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { billId, vendorId } = req.query;
    const where = { ...tf };
    if (billId) where.billId = billId;
    if (vendorId) where.bill = { vendorId };
    const payments = await prisma.vendorPayment.findMany({
      where,
      include: {
        bill: { include: { vendor: { select: { id: true, name: true } } } },
        paidBy: { select: { id: true, name: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 200,
    });
    res.json({ payments });
  } catch (err) {
    console.error('vendor-payments GET / error:', err);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

// GET /aging — vendor-wise AP aging buckets
router.get('/aging', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const now = new Date();
    const bills = await prisma.vendorBill.findMany({
      where: {
        ...tf,
        status: { in: ['pending', 'approved', 'partial', 'overdue'] },
      },
      include: { vendor: { select: { id: true, name: true } } },
    });

    const byVendor = {};
    let totals = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0, total: 0 };
    for (const b of bills) {
      const outstanding = Number(b.amount) - Number(b.paidAmount || 0);
      if (outstanding <= 0.005) continue;
      const daysOverdue = Math.floor((now - new Date(b.dueDate)) / 86400000);
      const bucket = daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? 'd1_30' : daysOverdue <= 60 ? 'd31_60' : 'd60plus';
      totals[bucket] += outstanding;
      totals.total += outstanding;
      const vid = b.vendorId;
      if (!byVendor[vid]) {
        byVendor[vid] = {
          vendorId: vid,
          vendorName: b.vendor?.name || 'Unknown',
          current: 0, d1_30: 0, d31_60: 0, d60plus: 0, total: 0, billCount: 0,
        };
      }
      byVendor[vid][bucket] += outstanding;
      byVendor[vid].total += outstanding;
      byVendor[vid].billCount += 1;
    }

    const vendors = Object.values(byVendor).sort((a, b) => b.total - a.total);
    res.json({ totals, vendors });
  } catch (err) {
    console.error('vendor-payments GET /aging error:', err);
    res.status(500).json({ error: 'Failed to compute aging' });
  }
});

module.exports = router;
