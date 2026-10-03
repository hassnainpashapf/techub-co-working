// Phase 39 Track 4: Quotations for Leads — CRUD, PDF, send-via-email, accept.
// Mount (coordinator): app.use('/api/quotations', require('./routes/quotations'));
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { sendEmail, getTenantBrand } = require('../lib/mailer');
const { generateQuotationPdf } = require('../lib/quotation-pdf');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const SALES_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'sales'];
const salesOnly = requireRole(...SALES_ROLES);
const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

const lineItem = z.object({
  desc: z.string().min(1).max(200),
  qty: z.number().positive(),
  price: z.number().nonnegative(),
});

const quotationSchema = z.object({
  leadId: z.string().min(1),
  items: z.array(lineItem).min(1).max(50),
  validTill: z.string().min(1), // ISO date
  notes: z.string().max(5000).optional().default(''),
});

const totalOf = (items) => {
  const t = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);
  return Math.round(t * 100) / 100;
};

async function nextQuotationNumber(tenantId) {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const countForMonth = await prisma.quotation.count({
    where: { tenantId, number: { startsWith: `Q-${yyyymm}-` } },
  });
  return `Q-${yyyymm}-${String(countForMonth + 1).padStart(4, '0')}`;
}

function missingSchema(req, res, next) {
  if (typeof prisma.quotation === 'undefined') {
    return res.status(503).json({ error: { message: 'Quotations schema not merged yet. Deploy pending.' } });
  }
  next();
}

// LeadActivity is added by Phase 39 Track 1 — log when available, skip silently before merge.
async function logLeadActivity(tenantId, leadId, type, body, actorId) {
  try {
    if (!prisma.leadActivity) return;
    await prisma.leadActivity.create({ data: { tenantId, leadId, type, body, createdBy: actorId || null } });
  } catch { /* ignore */ }
}

const INCLUDE = { lead: { select: { id: true, name: true, email: true, phone: true, company: true, stage: true } } };

// Stats
router.get('/stats', salesOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const counts = await prisma.quotation.groupBy({ by: ['status'], where: tf, _count: { _all: true } });
    const value = await prisma.quotation.aggregate({
      where: { ...tf, status: 'sent' }, _sum: { total: true },
    });
    const expired = await prisma.quotation.count({
      where: { ...tf, status: { in: ['draft', 'sent'] }, validTill: { lt: new Date() } },
    });
    res.json({
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      openValue: value._sum.total || 0,
      pastDue: expired,
    });
  } catch (e) { next(e); }
});

// List
router.get('/', salesOnly, missingSchema, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status && STATUSES.includes(String(req.query.status))) where.status = req.query.status;
    if (req.query.leadId) where.leadId = req.query.leadId;
    const quotations = await prisma.quotation.findMany({
      where, include: INCLUDE, orderBy: { createdAt: 'desc' }, take: 100,
    });
    res.json({ quotations });
  } catch (e) { next(e); }
});

// Get one
router.get('/:id', salesOnly, missingSchema, async (req, res, next) => {
  try {
    const q = await prisma.quotation.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) }, include: INCLUDE,
    });
    if (!q) return res.status(404).json({ error: { message: 'Quotation not found' } });
    res.json({ quotation: q });
  } catch (e) { next(e); }
});

// Create
router.post('/', salesOnly, missingSchema, validateBody(quotationSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { leadId, items, validTill, notes } = req.body;
    const lead = await prisma.lead.findFirst({ where: { id: leadId, ...tf } });
    if (!lead) return res.status(404).json({ error: { message: 'Lead not found' } });
    const quotation = await prisma.quotation.create({
      data: {
        tenantId: tf.tenantId,
        leadId: lead.id,
        number: await nextQuotationNumber(tf.tenantId),
        items,
        total: totalOf(items),
        validTill: new Date(validTill),
        status: 'draft',
        notes: notes || null,
        createdBy: req.user.sub,
      },
      include: INCLUDE,
    });
    await logLeadActivity(tf.tenantId, lead.id, 'quotation_created', `Quotation ${quotation.number} drafted (Rs ${Number(quotation.total).toLocaleString()})`, req.user.sub);
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'quotation.create', entity: 'Quotation', entityId: quotation.id, newValue: { number: quotation.number, total: String(quotation.total) }, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.status(201).json({ quotation });
  } catch (e) { next(e); }
});

// Update (draft only)
router.patch('/:id', salesOnly, missingSchema, validateBody(quotationSchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.quotation.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: { message: 'Quotation not found' } });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: { message: 'Only draft quotations can be edited' } });
    }
    const data = {};
    if (req.body.items) { data.items = req.body.items; data.total = totalOf(req.body.items); }
    if (req.body.validTill) data.validTill = new Date(req.body.validTill);
    if (req.body.notes !== undefined) data.notes = req.body.notes || null;
    if (req.body.leadId) {
      const lead = await prisma.lead.findFirst({ where: { id: req.body.leadId, ...tenantFilter(req) } });
      if (!lead) return res.status(404).json({ error: { message: 'Lead not found' } });
      data.leadId = lead.id;
    }
    const quotation = await prisma.quotation.update({ where: { id: existing.id }, data, include: INCLUDE });
    res.json({ quotation });
  } catch (e) { next(e); }
});

// Delete (draft only)
router.delete('/:id', salesOnly, missingSchema, async (req, res, next) => {
  try {
    const existing = await prisma.quotation.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: { message: 'Quotation not found' } });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: { message: 'Only draft quotations can be deleted' } });
    }
    await prisma.quotation.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PDF download (branded)
router.get('/:id/pdf', salesOnly, missingSchema, async (req, res, next) => {
  try {
    const q = await prisma.quotation.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) }, include: INCLUDE,
    });
    if (!q) return res.status(404).json({ error: { message: 'Quotation not found' } });
    const pdf = await generateQuotationPdf(q);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${q.number}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (e) { next(e); }
});

// Send: email with PDF attached + status -> sent
router.post('/:id/send', salesOnly, missingSchema, async (req, res, next) => {
  try {
    const q = await prisma.quotation.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) }, include: INCLUDE,
    });
    if (!q) return res.status(404).json({ error: { message: 'Quotation not found' } });
    if (q.status !== 'draft') {
      return res.status(409).json({ error: { message: `Cannot send a ${q.status} quotation` } });
    }
    if (!q.lead?.email) {
      return res.status(422).json({ error: { message: 'Lead has no email address on file' } });
    }
    const brand = await getTenantBrand(req.user.tenantId).catch(() => ({ brandName: 'CoworkOS' }));
    const pdf = await generateQuotationPdf(q);
    await sendEmail(req.user.tenantId, {
      to: q.lead.email,
      subject: `Quotation ${q.number} — ${brand.brandName}`,
      html: `<p>Hi ${q.lead.name || 'there'},</p><p>Please find attached your quotation <b>${q.number}</b> for <b>Rs ${Number(q.total).toLocaleString()}</b>, valid until <b>${new Date(q.validTill).toLocaleDateString()}</b>.</p><p>Reply to this email or call us if you have any questions.</p><p>Warm regards,<br/>${brand.brandName}</p>`,
      attachments: [{ filename: `${q.number}.pdf`, content: pdf }],
    });
    const quotation = await prisma.quotation.update({
      where: { id: q.id }, data: { status: 'sent', sentAt: new Date() }, include: INCLUDE,
    });
    await logLeadActivity(req.user.tenantId, q.leadId, 'quotation_sent', `Quotation ${q.number} sent to ${q.lead.email}`, req.user.sub);
    await writeAudit({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'quotation.send', entity: 'Quotation', entityId: q.id, newValue: { number: q.number, to: q.lead.email }, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ quotation });
  } catch (e) { next(e); }
});

// Accept: status -> accepted + lead stage -> won (Track 7 conversion handles member creation)
router.post('/:id/accept', salesOnly, missingSchema, async (req, res, next) => {
  try {
    const q = await prisma.quotation.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) }, include: INCLUDE,
    });
    if (!q) return res.status(404).json({ error: { message: 'Quotation not found' } });
    if (!['draft', 'sent'].includes(q.status)) {
      return res.status(409).json({ error: { message: `Cannot accept a ${q.status} quotation` } });
    }
    const [quotation] = await prisma.$transaction([
      prisma.quotation.update({ where: { id: q.id }, data: { status: 'accepted' }, include: INCLUDE }),
      prisma.lead.update({ where: { id: q.leadId }, data: { stage: 'won' } }),
    ]);
    await logLeadActivity(req.user.tenantId, q.leadId, 'quotation_accepted', `Quotation ${q.number} accepted — lead marked won`, req.user.sub);
    await writeAudit({ tenantId: req.user.tenantId, actorId: req.user.sub, action: 'quotation.accept', entity: 'Quotation', entityId: q.id, newValue: { number: q.number }, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    res.json({ quotation });
  } catch (e) { next(e); }
});

// Reject
router.post('/:id/reject', salesOnly, missingSchema, async (req, res, next) => {
  try {
    const q = await prisma.quotation.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!q) return res.status(404).json({ error: { message: 'Quotation not found' } });
    if (!['draft', 'sent'].includes(q.status)) {
      return res.status(409).json({ error: { message: `Cannot reject a ${q.status} quotation` } });
    }
    const quotation = await prisma.quotation.update({ where: { id: q.id }, data: { status: 'rejected' }, include: INCLUDE });
    await logLeadActivity(req.user.tenantId, q.leadId, 'quotation_rejected', `Quotation ${q.number} rejected`, req.user.sub);
    res.json({ quotation });
  } catch (e) { next(e); }
});

module.exports = router;
