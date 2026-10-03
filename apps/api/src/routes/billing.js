const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { emitWebhook } = require('../lib/webhooks');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { tenantFilter, todayDateOnly, refreshOverdue } = require('../lib/tenant');
const { generateInvoicePdf } = require('../lib/invoice-pdf');
const { invalidateTenantCache } = require('../middleware/cache');

const router = express.Router();

router.use(authenticate, requireTenantUser);
router.use(invalidateTenantCache);

const BILLING_ROLES = ['ceo', 'admin', 'finance_officer'];
const billingWrite = requireRole(...BILLING_ROLES);
const paymentWrite = requireRole(...BILLING_ROLES, 'receptionist');

const OPEN_INVOICE_STATUSES = ['unpaid', 'partial', 'overdue'];

// Fire-and-forget audit helper (never breaks the request)
const auditAsync = (data) => writeAudit(data).catch(() => {});

// ------------------------------------------------------------ bulk actions ---
// Phase 30: bulk invoice status (ceo/admin/manager only — sirf status, koi payment record nahi)
const bulkInvoiceWrite = requireRole('ceo', 'admin', 'manager', 'super_admin');

const bulkInvoiceStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  status: z.enum(['paid', 'unpaid', 'cancelled']),
});

router.post('/invoices/bulk/status', bulkInvoiceWrite, validateBody(bulkInvoiceStatusSchema), async (req, res, next) => {
  try {
    const { ids, status } = req.body;
    const result = await prisma.invoice.updateMany({
      where: { id: { in: ids }, ...tenantFilter(req) },
      data: { status },
    });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'invoice.bulk_status', entity: 'Invoice', newValue: { count: result.count, status }, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.json({ updated: result.count });
  } catch (err) {
    return next(err);
  }
});

const generateSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
});

// Phase 31: manual invoice creation incl. proforma type
const createInvoiceSchema = z.object({
  memberId: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.coerce.date(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  notes: z.string().optional().nullable(),
  invoiceType: z.enum(['standard', 'proforma']).default('standard'),
});

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  method: z.string().min(1),
  paidAt: z.coerce.date().optional(),
  receiptNo: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

// -------------------------------------------------------------- invoices ---
router.get('/invoices', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    // Member portal: only their own invoices.
    if (req.user.role === 'member') {
      where.memberId = req.user.memberId;
    } else {
      if (req.query.status) where.status = String(req.query.status);
      if (req.query.memberId) where.memberId = String(req.query.memberId);
      // Phase 31: filter by invoice type (standard | proforma)
      if (req.query.type && ['standard', 'proforma'].includes(String(req.query.type))) {
        where.invoiceType = String(req.query.type);
      }
      if (req.query.month) {
        // month=YYYY-MM → periodStart within that calendar month
        const m = String(req.query.month).match(/^(\d{4})-(\d{2})$/);
        if (m) {
          const start = new Date(Number(m[1]), Number(m[2]) - 1, 1);
          const end = new Date(Number(m[1]), Number(m[2]), 1);
          where.periodStart = { gte: start, lt: end };
        }
      }
    }
    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        member: { select: { id: true, name: true, phone: true, creditLimit: true } },
        payments: { select: { id: true, amount: true, method: true, paidAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ invoices });
  } catch (err) {
    return next(err);
  }
});

// Generate monthly rent invoices for every active contract overlapping `month`.
// Invoice numbering: INV-<YYYYMM>-<seq>, seq = per-tenant count of invoices
// already created for that month + 1, zero-padded to 4.
router.post('/invoices/generate', billingWrite, validateBody(generateSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const [year, month] = req.body.month.split('-').map(Number);
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0); // last day of month
    const dueDate = new Date(periodEnd);
    dueDate.setDate(dueDate.getDate() + 7); // periodEnd + 7 days
    const yyyymm = `${year}${String(month).padStart(2, '0')}`;

    // An active contract overlaps the month if it starts on/before month end
    // and has no end date or ends on/after month start.
    const contracts = await prisma.contract.findMany({
      where: {
        ...tf,
        status: 'active',
        startDate: { lte: periodEnd },
        OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
      },
    });

    let created = 0;
    for (const contract of contracts) {
      const exists = await prisma.invoice.findFirst({
        where: { tenantId: tf.tenantId, contractId: contract.id, periodStart },
      });
      if (exists) continue; // idempotent: never double-bill the same period

      // Per-tenant sequence for this month: count existing invoices whose
      // number belongs to this YYYYMM, then +1.
      const countForMonth = await prisma.invoice.count({
        where: { tenantId: tf.tenantId, number: { startsWith: `INV-${yyyymm}-` } },
      });
      const seq = String(countForMonth + 1).padStart(4, '0');

      await prisma.invoice.create({
        data: {
          tenantId: tf.tenantId,
          memberId: contract.memberId,
          contractId: contract.id,
          number: `INV-${yyyymm}-${seq}`,
          periodStart,
          periodEnd,
          dueDate,
          amount: contract.rentAmount,
          status: 'unpaid',
        },
      });
      created += 1;
    }

    if (created > 0) emitWebhook(tf.tenantId, 'invoice.created', { count: created, month: yyyymm });
    return res.status(201).json({ created });
  } catch (err) {
    return next(err);
  }
});

// Phase 31: manual invoice creation (standard or proforma).
// Proforma invoices are estimates — they cannot receive payments until converted.
router.post('/invoices', billingWrite, validateBody(createInvoiceSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { memberId, amount, dueDate, periodStart, periodEnd, notes, invoiceType } = req.body;

    const member = await prisma.member.findFirst({ where: { id: memberId, ...tf } });
    if (!member) return res.status(404).json({ error: { message: 'Member not found' } });

    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = invoiceType === 'proforma' ? 'PRO' : 'INV';
    const countForMonth = await prisma.invoice.count({
      where: { tenantId: tf.tenantId, number: { startsWith: `${prefix}-${yyyymm}-` } },
    });
    const seq = String(countForMonth + 1).padStart(4, '0');

    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tf.tenantId,
        memberId: member.id,
        number: `${prefix}-${yyyymm}-${seq}`,
        periodStart: periodStart || now,
        periodEnd: periodEnd || now,
        dueDate,
        amount,
        status: 'unpaid',
        invoiceType,
        notes: notes || null,
      },
    });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'invoice.created', entity: 'Invoice', entityId: invoice.id, newValue: { number: invoice.number, invoiceType }, ip: req.ip, userAgent: req.headers['user-agent'] });
    return res.status(201).json({ invoice });
  } catch (err) {
    return next(err);
  }
});

// Phase 31: convert a proforma invoice into a standard invoice.
// Gets a fresh INV- series number; payments are only allowed after conversion.
router.post('/invoices/:id/convert', billingWrite, async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!invoice) return res.status(404).json({ error: { message: 'Invoice not found' } });
    if (invoice.invoiceType !== 'proforma') {
      return res.status(400).json({ error: { message: 'Only proforma invoices can be converted' } });
    }
    if (invoice.status === 'cancelled') {
      return res.status(400).json({ error: { message: 'Cannot convert a cancelled invoice' } });
    }

    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const countForMonth = await prisma.invoice.count({
      where: { tenantId: invoice.tenantId, number: { startsWith: `INV-${yyyymm}-` } },
    });
    const seq = String(countForMonth + 1).padStart(4, '0');

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { invoiceType: 'standard', number: `INV-${yyyymm}-${seq}` },
    });
    auditAsync({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'invoice.converted', entity: 'Invoice', entityId: invoice.id, newValue: { from: invoice.number, to: updated.number }, ip: req.ip, userAgent: req.headers['user-agent'] });
    emitWebhook(invoice.tenantId, 'invoice.created', { id: updated.id, number: updated.number });
    return res.json({ invoice: updated });
  } catch (err) {
    return next(err);
  }
});

router.get('/invoices/:id', async (req, res, next) => {
  try {
    const where = { id: req.params.id, ...tenantFilter(req) };
    if (req.user.role === 'member') where.memberId = req.user.memberId;
    const invoice = await prisma.invoice.findFirst({
      where,
      include: {
        member: { select: { id: true, name: true, phone: true } },
        contract: true,
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!invoice) return res.status(404).json({ error: { message: 'Invoice not found' } });
    return res.json({ invoice });
  } catch (err) {
    return next(err);
  }
});

// Download invoice as PDF
router.get('/invoices/:id/pdf', async (req, res, next) => {
  try {
    const where = { id: req.params.id, ...tenantFilter(req) };
    if (req.user.role === 'member') where.memberId = req.user.memberId;
    const invoice = await prisma.invoice.findFirst({
      where,
      include: {
        tenant: { select: { name: true, address: true, phone: true, email: true } },
        member: { select: { id: true, name: true, phone: true, companyName: true } },
        contract: true,
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!invoice) return res.status(404).json({ error: { message: 'Invoice not found' } });
    const pdf = await generateInvoicePdf(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.number}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
});

router.patch('/invoices/:id/cancel', billingWrite, async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!invoice) return res.status(404).json({ error: { message: 'Invoice not found' } });
    if (Number(invoice.amountPaid) > 0) {
      return res.status(400).json({
        error: { message: 'Cannot cancel invoice: payments have been recorded' },
      });
    }
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'cancelled' },
    });
    return res.json({ invoice: updated });
  } catch (err) {
    return next(err);
  }
});

// -------------------------------------------------------------- payments ---
router.post('/payments', paymentWrite, validateBody(paymentSchema), async (req, res, next) => {
  try {
    const { invoiceId, amount, method, paidAt, receiptNo, note } = req.body;
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, ...tenantFilter(req) },
    });
    if (!invoice) return res.status(404).json({ error: { message: 'Invoice not found' } });
    if (invoice.status === 'cancelled') {
      return res.status(400).json({
        error: { message: 'Cannot record payment on a cancelled invoice' },
      });
    }
    // Phase 31: proforma invoices are estimates — convert before accepting payment
    if (invoice.invoiceType === 'proforma') {
      return res.status(400).json({
        error: { message: 'Cannot record payment on a proforma invoice — convert it to a standard invoice first' },
      });
    }

    const remaining = Number(invoice.amount) - Number(invoice.amountPaid);
    if (amount > remaining) {
      return res.status(400).json({
        error: { message: `Payment exceeds remaining balance of ${remaining}` },
      });
    }

    const newAmountPaid = Number(invoice.amountPaid) + amount;
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          ...tenantFilter(req),
          invoiceId: invoice.id,
          amount,
          method,
          receiptNo: receiptNo || `RCP-${Date.now()}`,
          paidAt: paidAt || new Date(),
          note: note || null,
        },
      });
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: newAmountPaid,
          // Fully paid → paid; anything less → partial (overdue clears to partial
          // and refreshOverdue will flip it back only if still past due).
          status: newAmountPaid >= Number(invoice.amount) ? 'paid' : 'partial',
        },
      });
      return { payment, invoice: updatedInvoice };
    });

    // Email receipt notification (non-blocking)
    const member = await prisma.member.findFirst({
      where: { id: invoice.memberId, ...tenantFilter(req) },
      select: { name: true, email: true },
    });
    if (member?.email) {
      const { notify } = require('../lib/mailer');
      notify(req.user.tenantId, member.email, 'paymentReceived', {
        memberName: member.name,
        amount,
        invoiceNumber: invoice.number,
      }).catch(() => {});
    }
    emitWebhook(req.user.tenantId, 'payment.received', { id: result.payment.id, amount: result.payment.amount, method: result.payment.method, invoiceNumber: invoice.number });
    // Slack integration (Phase 36) — fire-and-forget, never blocks the request
    require('../lib/slack').notifyEvent(req.user.tenantId, 'payment_received', { id: result.payment.id, amount: result.payment.amount, method: result.payment.method, invoiceNumber: invoice.number }).catch(() => {});

    // Phase 33: loyalty auto-earn — invoice just flipped to fully paid -> points (non-blocking)
    if (result.invoice.status === 'paid' && invoice.status !== 'paid') {
      const { awardForPayment } = require('../lib/loyalty');
      awardForPayment(req.user.tenantId, invoice.memberId, invoice.amount, invoice.id).catch(() => {});
    }

    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
});

// ------------------------------------------------------------------- dues ---
router.get('/dues', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    await refreshOverdue(prisma, req.user.tenantId);
    const where = { ...tf, status: { in: OPEN_INVOICE_STATUSES } };
    if (req.user.role === 'member') where.memberId = req.user.memberId;
    const invoices = await prisma.invoice.findMany({
      where,
      include: { member: { select: { id: true, name: true, phone: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const today = todayDateOnly();
    const dues = invoices.map((inv) => {
      const due = new Date(inv.dueDate);
      due.setHours(0, 0, 0, 0);
      const daysOverdue = Math.max(0, Math.floor((today - due) / (1000 * 60 * 60 * 24)));
      return {
        ...inv,
        remaining: Number(inv.amount) - Number(inv.amountPaid),
        daysOverdue,
      };
    });
    return res.json({ dues });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
