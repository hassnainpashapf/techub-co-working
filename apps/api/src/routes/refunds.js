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

const FINANCE_ROLES = ['ceo', 'admin', 'finance_officer'];
const financeWrite = requireRole(...FINANCE_ROLES);

const refundSchema = z.object({
  memberId: z.string().min(1),
  paymentId: z.string().optional().nullable(),
  amount: z.number().positive(),
  reason: z.string().optional().nullable(),
});

const includeRefund = {
  member: { select: { id: true, name: true } },
  payment: { select: { id: true, receiptNo: true, amount: true } },
  requestedBy: { select: { id: true, name: true } },
  processedBy: { select: { id: true, name: true } },
};

async function nextRefundNumber(tenantId) {
  const now = new Date();
  const prefix = `RFD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const last = await prisma.refund.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const seq = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// List refunds
router.get('/', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.user.role === 'member' && req.user.memberId) where.memberId = req.user.memberId;
    else if (req.query.memberId) where.memberId = String(req.query.memberId);
    if (req.query.status) where.status = String(req.query.status);
    const refunds = await prisma.refund.findMany({
      where,
      include: includeRefund,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ refunds });
  } catch (e) { next(e); }
});

// Request a refund
router.post('/', financeWrite, validateBody(refundSchema), async (req, res, next) => {
  try {
    const member = await prisma.member.findFirst({
      where: { id: req.body.memberId, ...tenantFilter(req) },
    });
    if (!member) return res.status(400).json({ error: 'Member not found' });
    if (req.body.paymentId) {
      const payment = await prisma.payment.findFirst({
        where: { id: req.body.paymentId, ...tenantFilter(req) },
      });
      if (!payment) return res.status(400).json({ error: 'Payment not found' });
      if (Number(req.body.amount) > Number(payment.amount)) {
        return res.status(400).json({ error: 'Refund exceeds payment amount' });
      }
    }
    const refund = await prisma.refund.create({
      data: {
        ...req.body,
        tenantId: req.user.tenantId,
        number: await nextRefundNumber(req.user.tenantId),
        requestedById: req.user.id,
      },
      include: includeRefund,
    });
    await writeAudit(req, 'refund.request', 'Refund', refund.id, null, { number: refund.number });
    res.status(201).json({ refund });
  } catch (e) { next(e); }
});

// Approve / reject / process
router.post('/:id/:action', financeWrite, async (req, res, next) => {
  try {
    const { action } = req.params;
    if (!['approve', 'reject', 'process'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const refund = await prisma.refund.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    let data;
    if (action === 'approve' && refund.status === 'pending') {
      data = { status: 'approved' };
    } else if (action === 'reject' && refund.status === 'pending') {
      data = { status: 'rejected', processedById: req.user.id, processedAt: new Date() };
    } else if (action === 'process' && refund.status === 'approved') {
      data = { status: 'processed', processedById: req.user.id, processedAt: new Date() };
    } else {
      return res.status(400).json({ error: `Cannot ${action} a ${refund.status} refund` });
    }

    const updated = await prisma.refund.update({
      where: { id: refund.id },
      data,
      include: includeRefund,
    });
    await writeAudit(req, `refund.${action}`, 'Refund', refund.id, { status: refund.status }, { status: updated.status });
    res.json({ refund: updated });
  } catch (e) { next(e); }
});

module.exports = router;
