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

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const write = requireRole(...WRITE_ROLES);
const FINANCE_ROLES = ['ceo', 'admin', 'finance_officer'];
const financeWrite = requireRole(...FINANCE_ROLES);

// --------------------------------------------------------------- documents ---
const docSchema = z.object({
  title: z.string().min(1),
  category: z.string().default('general'),
  memberId: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  fileSize: z.number().int().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get('/documents', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.user.role === 'member' && req.user.memberId) where.memberId = req.user.memberId;
    else if (req.query.memberId) where.memberId = String(req.query.memberId);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.search) where.title = { contains: String(req.query.search), mode: 'insensitive' };
    const documents = await prisma.document.findMany({
      where,
      include: {
        member: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents });
  } catch (e) { next(e); }
});

router.post('/documents', write, validateBody(docSchema), async (req, res, next) => {
  try {
    const doc = await prisma.document.create({
      data: { ...req.body, tenantId: req.user.tenantId, uploadedById: req.user.id },
      include: { member: { select: { id: true, name: true } } },
    });
    await writeAudit(req, 'document.create', 'Document', doc.id, null, { title: doc.title });
    res.status(201).json({ document: doc });
  } catch (e) { next(e); }
});

router.delete('/documents/:id', write, async (req, res, next) => {
  try {
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    await prisma.document.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ------------------------------------------------------------ credit notes ---
const cnSchema = z.object({
  memberId: z.string().min(1),
  invoiceId: z.string().optional().nullable(),
  amount: z.number().positive(),
  reason: z.string().optional().nullable(),
});

async function nextCnNumber(tenantId) {
  const now = new Date();
  const prefix = `CN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const last = await prisma.creditNote.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const seq = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

router.get('/credit-notes', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.user.role === 'member' && req.user.memberId) where.memberId = req.user.memberId;
    else if (req.query.memberId) where.memberId = String(req.query.memberId);
    if (req.query.status) where.status = String(req.query.status);
    const notes = await prisma.creditNote.findMany({
      where,
      include: {
        member: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ creditNotes: notes });
  } catch (e) { next(e); }
});

router.post('/credit-notes', financeWrite, validateBody(cnSchema), async (req, res, next) => {
  try {
    const member = await prisma.member.findFirst({
      where: { id: req.body.memberId, ...tenantFilter(req) },
    });
    if (!member) return res.status(400).json({ error: 'Member not found' });
    const cn = await prisma.creditNote.create({
      data: {
        ...req.body,
        tenantId: req.user.tenantId,
        number: await nextCnNumber(req.user.tenantId),
        createdById: req.user.id,
      },
      include: { member: { select: { id: true, name: true } } },
    });
    await writeAudit(req, 'creditnote.create', 'CreditNote', cn.id, null, { number: cn.number });
    res.status(201).json({ creditNote: cn });
  } catch (e) { next(e); }
});

// Apply credit note to an invoice
router.post('/credit-notes/:id/apply', financeWrite, validateBody(z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
})), async (req, res, next) => {
  try {
    const cn = await prisma.creditNote.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!cn) return res.status(404).json({ error: 'Credit note not found' });
    if (cn.status !== 'open') return res.status(400).json({ error: 'Credit note is not open' });
    const available = Number(cn.amount) - Number(cn.amountUsed);
    if (req.body.amount > available) return res.status(400).json({ error: 'Amount exceeds available credit' });

    const invoice = await prisma.invoice.findFirst({
      where: { id: req.body.invoiceId, ...tenantFilter(req) },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const newUsed = Number(cn.amountUsed) + req.body.amount;
    const newPaid = Number(invoice.amountPaid) + req.body.amount;
    const newStatus = newPaid >= Number(invoice.amount) ? 'paid' : newPaid > 0 ? 'partial' : invoice.status;

    await prisma.$transaction([
      prisma.creditNote.update({
        where: { id: cn.id },
        data: {
          amountUsed: newUsed,
          status: newUsed >= Number(cn.amount) ? 'applied' : 'open',
        },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid: newPaid, status: newStatus },
      }),
      prisma.payment.create({
        data: {
          tenantId: req.user.tenantId,
          invoiceId: invoice.id,
          memberId: invoice.memberId,
          amount: req.body.amount,
          method: 'credit_note',
          note: `Applied ${cn.number}`,
          paidAt: new Date(),
        },
      }),
    ]);
    res.json({ ok: true, applied: req.body.amount });
  } catch (e) { next(e); }
});

router.post('/credit-notes/:id/cancel', financeWrite, async (req, res, next) => {
  try {
    const cn = await prisma.creditNote.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!cn) return res.status(404).json({ error: 'Credit note not found' });
    if (Number(cn.amountUsed) > 0) return res.status(400).json({ error: 'Cannot cancel: credit already used' });
    await prisma.creditNote.update({ where: { id: cn.id }, data: { status: 'cancelled' } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
