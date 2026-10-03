// Phase 41 Track 2: Purchase Orders — CRUD, approval flow, branded PDF.
// Mount (coordinator): app.use('/api/purchase-orders', require('./routes/purchase-orders'));
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { getTenantBrand } = require('../lib/mailer');
const { generatePOPdf } = require('../lib/po-pdf');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const PROC_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'finance'];
const procOnly = requireRole(...PROC_ROLES);
const APPROVER_ROLES = ['ceo', 'admin', 'super_admin'];
const approverOnly = requireRole(...APPROVER_ROLES);

const STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'ordered', 'received', 'closed'];

const lineItem = z.object({
  desc: z.string().min(1).max(200),
  qty: z.number().positive(),
  price: z.number().nonnegative(),
});

const poSchema = z.object({
  vendorId: z.string().min(1),
  items: z.array(lineItem).min(1).max(100),
  tax: z.number().nonnegative().optional().default(0),
  notes: z.string().max(5000).optional().default(''),
});

const totalsOf = (items, tax) => {
  const subtotal = Math.round(items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0) * 100) / 100;
  const t = Math.round(Number(tax || 0) * 100) / 100;
  return { subtotal, tax: t, total: Math.round((subtotal + t) * 100) / 100 };
};

async function nextPONumber(tenantId) {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const countForMonth = await prisma.purchaseOrder.count({
    where: { tenantId, number: { startsWith: `PO-${yyyymm}-` } },
  });
  return `PO-${yyyymm}-${String(countForMonth + 1).padStart(4, '0')}`;
}

function missingSchema(req, res, next) {
  if (typeof prisma.purchaseOrder === 'undefined') {
    return res.status(503).json({ error: { message: 'Purchase Orders schema not merged yet. Deploy pending.' } });
  }
  next();
}

router.use(procOnly, missingSchema);

const include = {
  vendor: { select: { id: true, name: true, company: true, email: true, phone: true, paymentTerms: true } },
  approvals: { include: { approver: { select: { id: true, name: true } } }, orderBy: { decidedAt: 'desc' } },
};

// GET / — list with filters
router.get('/', async (req, res) => {
  const { status, vendorId, q } = req.query;
  const where = tenantFilter(req);
  if (status && STATUSES.includes(status)) where.status = status;
  if (vendorId) where.vendorId = vendorId;
  if (q) where.OR = [{ number: { contains: q, mode: 'insensitive' } }, { notes: { contains: q, mode: 'insensitive' } }];
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.purchaseOrder.count({ where }),
  ]);
  const pending = await prisma.purchaseOrder.count({ where: { ...tenantFilter(req), status: 'pending_approval' } });
  res.json({ data: rows, total, pending });
});

// GET /:id
router.get('/:id', async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) }, include });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  res.json({ data: po });
});

// POST / — create draft
router.post('/', validateBody(poSchema), async (req, res) => {
  const vendor = await prisma.vendor.findFirst({
    where: { id: req.body.vendorId, ...tenantFilter(req), isActive: true },
  });
  if (!vendor) return res.status(422).json({ error: { message: 'Vendor not found or inactive' } });
  const { subtotal, tax, total } = totalsOf(req.body.items, req.body.tax);
  const po = await prisma.purchaseOrder.create({
    data: {
      tenantId: req.user.tenantId,
      number: await nextPONumber(req.user.tenantId),
      vendorId: vendor.id,
      items: req.body.items,
      subtotal, tax, total,
      notes: req.body.notes,
      requestedBy: req.user.sub,
    },
    include,
  });
  await writeAudit(req, 'po.create', 'PurchaseOrder', po.id, { number: po.number, total: String(po.total) });
  res.status(201).json({ data: po });
});

// PATCH /:id — draft-only edit
router.patch('/:id', validateBody(poSchema.partial()), async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  if (po.status !== 'draft') return res.status(422).json({ error: { message: 'Only draft POs can be edited' } });

  const data = {};
  if (req.body.vendorId) {
    const vendor = await prisma.vendor.findFirst({ where: { id: req.body.vendorId, ...tenantFilter(req) } });
    if (!vendor) return res.status(422).json({ error: { message: 'Vendor not found' } });
    data.vendorId = vendor.id;
  }
  if (req.body.items || req.body.tax !== undefined) {
    const items = req.body.items || po.items;
    const tax = req.body.tax !== undefined ? req.body.tax : Number(po.tax);
    const { subtotal, tax: t, total } = totalsOf(items, tax);
    data.items = items; data.subtotal = subtotal; data.tax = t; data.total = total;
  }
  if (req.body.notes !== undefined) data.notes = req.body.notes;

  const updated = await prisma.purchaseOrder.update({ where: { id: po.id }, data, include });
  await writeAudit(req, 'po.update', 'PurchaseOrder', po.id, { number: po.number });
  res.json({ data: updated });
});

// DELETE /:id — draft-only
router.delete('/:id', async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  if (po.status !== 'draft') return res.status(422).json({ error: { message: 'Only draft POs can be deleted' } });
  await prisma.purchaseOrder.delete({ where: { id: po.id } });
  await writeAudit(req, 'po.delete', 'PurchaseOrder', po.id, { number: po.number });
  res.json({ ok: true });
});

// POST /:id/submit — draft -> pending_approval (multi-level engine)
router.post('/:id/submit', async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  if (po.status !== 'draft') return res.status(422).json({ error: { message: 'Only draft POs can be submitted' } });
  const poApprovals = require('../lib/poApprovals');
  try {
    const result = await poApprovals.submitForApproval({ tenantId: req.user.tenantId, poId: po.id, actorId: req.user.sub });
    await writeAudit(req, 'po.submit', 'PurchaseOrder', po.id, { number: po.number });
    res.json({ data: result });
  } catch (e) {
    res.status(e.status || 500).json({ error: { message: e.message || 'Submit failed' } });
  }
});

// POST /:id/approve — multi-level approval engine
router.post('/:id/approve', approverOnly, async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  if (po.status !== 'pending_approval') return res.status(422).json({ error: { message: 'PO is not pending approval' } });
  const poApprovals = require('../lib/poApprovals');
  try {
    const result = await poApprovals.approve({ tenantId: req.user.tenantId, poId: po.id, user: req.user, note: req.body?.note });
    await writeAudit(req, 'po.approve', 'PurchaseOrder', po.id, { number: po.number });
    res.json({ data: result });
  } catch (e) {
    res.status(e.status || 500).json({ error: { message: e.message || 'Approve failed' } });
  }
});

// POST /:id/reject — pending_approval -> rejected (multi-level engine)
router.post('/:id/reject', approverOnly, validateBody(z.object({ note: z.string().min(1).max(2000) })), async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  if (po.status !== 'pending_approval') return res.status(422).json({ error: { message: 'PO is not pending approval' } });
  const poApprovals = require('../lib/poApprovals');
  try {
    const result = await poApprovals.reject({ tenantId: req.user.tenantId, poId: po.id, user: req.user, note: req.body.note });
    await writeAudit(req, 'po.reject', 'PurchaseOrder', po.id, { number: po.number });
    res.json({ data: result });
  } catch (e) {
    res.status(e.status || 500).json({ error: { message: e.message || 'Reject failed' } });
  }
});

// GET /:id/approvals — approval timeline (frontend widget)
router.get('/:id/approvals', async (req, res) => {
  const poApprovals = require('../lib/poApprovals');
  try {
    const result = await poApprovals.getNextPendingLevel({ tenantId: req.user.tenantId, poId: req.params.id });
    res.json({ data: result });
  } catch (e) {
    res.status(e.status || 500).json({ error: { message: e.message || 'Failed to load approvals' } });
  }
});

// POST /:id/mark-ordered — approved -> ordered
router.post('/:id/mark-ordered', async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  if (po.status !== 'approved') return res.status(422).json({ error: { message: 'Only approved POs can be ordered' } });
  const updated = await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'ordered' }, include });
  await writeAudit(req, 'po.order', 'PurchaseOrder', po.id, { number: po.number });
  res.json({ data: updated });
});

// POST /:id/mark-received — ordered -> received
router.post('/:id/mark-received', async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  if (po.status !== 'ordered') return res.status(422).json({ error: { message: 'Only ordered POs can be received' } });
  const updated = await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'received' }, include });
  await writeAudit(req, 'po.receive', 'PurchaseOrder', po.id, { number: po.number });
  res.json({ data: updated });
});

// POST /:id/close — received -> closed
router.post('/:id/close', async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  if (po.status !== 'received') return res.status(422).json({ error: { message: 'Only received POs can be closed' } });
  const updated = await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'closed' }, include });
  await writeAudit(req, 'po.close', 'PurchaseOrder', po.id, { number: po.number });
  res.json({ data: updated });
});

// GET /:id/pdf — branded PO PDF
router.get('/:id/pdf', async (req, res) => {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, ...tenantFilter(req) }, include: { vendor: true } });
  if (!po) return res.status(404).json({ error: { message: 'Purchase order not found' } });
  const brand = await getTenantBrand(req.user.tenantId).catch(() => ({ brandName: 'CoworkOS', supportEmail: null }));
  const pdf = await generatePOPdf({ ...po, brand });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${po.number}.pdf"`);
  res.send(pdf);
});

module.exports = router;
