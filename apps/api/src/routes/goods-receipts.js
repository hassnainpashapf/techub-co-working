// Phase 41 Track 3: Goods Receipt Notes (GRN) — record what actually arrived
// against an approved PurchaseOrder. Partial receipts and discrepancies are
// tracked; mismatches alert the finance/manager roles.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { createNotification } = require('../lib/notify');

const router = express.Router();

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'finance', 'ops'];
const staffOnly = requireRole(...STAFF_ROLES);
const CONDITIONS = ['good', 'damaged', 'wrong'];

const grnItemSchema = z.object({
  desc: z.string().min(1).max(200),
  orderedQty: z.number().int().min(0),
  receivedQty: z.number().int().min(0),
  condition: z.enum(CONDITIONS).default('good'),
});

const createSchema = z.object({
  poId: z.string().min(1),
  items: z.array(grnItemSchema).min(1),
  discrepancies: z.string().max(2000).optional(),
  receivedAt: z.coerce.date().optional(),
});

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'GoodsReceipt',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

// Notify ceo/admin/manager/finance when items arrived short, damaged, or wrong.
async function alertMismatch(tenantId, po, problems) {
  const msg = `GRN mismatch on PO ${po.number}: ${problems.join('; ')}`;
  for (const role of ['ceo', 'admin', 'manager', 'finance']) {
    try {
      await createNotification(prisma, {
        tenantId,
        role,
        type: 'procurement.grn_mismatch',
        message: msg,
      });
    } catch {
      /* non-fatal */
    }
  }
}

async function poGuard(tenantId, poId) {
  if (!prisma.purchaseOrder) return { err: 503, msg: 'Purchase orders not enabled yet' };
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, ...tenantFilter(tenantId) },
    include: { vendor: { select: { id: true, name: true } } },
  });
  if (!po) return { err: 404, msg: 'Purchase order not found' };
  if (!['approved', 'ordered', 'received'].includes(po.status)) {
    return { err: 400, msg: `PO is ${po.status} — only approved/ordered POs can be received` };
  }
  return { po };
}

// ---------------------------------------------------------------------------
router.use(authenticate, requireTenantUser);

// GET / — list (filters: poId, status)
router.get('/', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.goodsReceipt) return res.status(503).json({ error: 'GRN not enabled yet' });
    const { poId, status } = req.query;
    const where = { ...tenantFilter(req.user.tenantId) };
    if (poId) where.poId = poId;
    if (status && ['complete', 'partial'].includes(status)) where.status = status;
    const grns = await prisma.goodsReceipt.findMany({
      where,
      include: {
        purchaseOrder: { select: { id: true, number: true, vendor: { select: { name: true } } } },
        receiver: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ grns });
  } catch (err) { next(err); }
});

// GET /pending — approved/ordered POs not fully received yet
router.get('/pending', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.purchaseOrder) return res.status(503).json({ error: 'Purchase orders not enabled yet' });
    const pos = await prisma.purchaseOrder.findMany({
      where: { ...tenantFilter(req.user.tenantId), status: { in: ['approved', 'ordered'] } },
      include: {
        vendor: { select: { id: true, name: true } },
        goodsReceipts: { select: { id: true, status: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ purchaseOrders: pos });
  } catch (err) { next(err); }
});

// POST / — record a goods receipt against a PO
router.post('/', staffOnly, validateBody(createSchema), async (req, res, next) => {
  try {
    if (!prisma.goodsReceipt) return res.status(503).json({ error: 'GRN not enabled yet' });
    const { poId, items, discrepancies, receivedAt } = req.body;
    const { err, msg, po } = await poGuard(req.user.tenantId, poId);
    if (err) return res.status(err).json({ error: msg });

    const problems = [];
    items.forEach((it, i) => {
      if (it.receivedQty < it.orderedQty) {
        problems.push(`"${it.desc}": received ${it.receivedQty}/${it.orderedQty}`);
      }
      if (it.condition !== 'good') {
        problems.push(`"${it.desc}": marked ${it.condition}`);
      }
    });
    const status = problems.length ? 'partial' : 'complete';

    const grn = await prisma.$transaction(async (tx) => {
      const created = await tx.goodsReceipt.create({
        data: {
          tenantId: req.user.tenantId,
          poId: po.id,
          receivedBy: req.user.sub,
          receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
          itemsReceived: items,
          discrepancies: discrepancies || (problems.length ? problems.join('\n') : null),
          status,
        },
      });
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'received' } });
      return created;
    });

    await audit(req, 'goods_receipt.create', grn.id, { poId: po.id, status, problems });
    if (problems.length) {
      await alertMismatch(req.user.tenantId, po, problems);
    }

    res.status(201).json({ grn, poStatus: 'received', problems });
  } catch (err) { next(err); }
});

// GET /:id
router.get('/:id', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.goodsReceipt) return res.status(503).json({ error: 'GRN not enabled yet' });
    const grn = await prisma.goodsReceipt.findFirst({
      where: { id: req.params.id, ...tenantFilter(req.user.tenantId) },
      include: {
        purchaseOrder: { select: { id: true, number: true, items: true, total: true, vendor: { select: { name: true } } } },
        receiver: { select: { id: true, name: true } },
      },
    });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });
    res.json({ grn });
  } catch (err) { next(err); }
});

module.exports = router;
