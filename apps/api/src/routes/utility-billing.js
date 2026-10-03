// Phase 51 Track 3: Utility Billing API
// Mount: app.use('/api/utility-billing', require('./routes/utility-billing'));
// server.js / Sidebar.js mat chhero. Sidebar link nahi (billing extend).
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);
const write = requireRole('ceo', 'admin', 'super_admin', 'manager');

const notMigrated = (res) =>
  !(prisma.utilityRate && prisma.utilityBill)
    ? (res.status(503).json({ error: 'Utility billing abhi migrate nahi hui' }), true)
    : false;

const UTILITY_TYPES = ['electricity', 'water', 'gas', 'internet'];

const rateSchema = z.object({
  type: z.enum(UTILITY_TYPES),
  ratePerUnit: z.number().positive(),
  fixedCharge: z.number().min(0).optional(),
  effectiveFrom: z.string().min(1),
});

// ---- Rates ----
router.get('/rates', async (req, res) => {
  if (notMigrated(res)) return;
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.type) where.type = req.query.type;
  const rates = await prisma.utilityRate.findMany({ where, orderBy: { effectiveFrom: 'desc' }, take: 100 });
  res.json({ rates });
});

router.post('/rates', write, validateBody(rateSchema), async (req, res) => {
  if (notMigrated(res)) return;
  const tf = tenantFilter(req);
  const rate = await prisma.utilityRate.create({
    data: {
      tenantId: tf.tenantId,
      type: req.body.type,
      ratePerUnit: req.body.ratePerUnit,
      fixedCharge: req.body.fixedCharge ?? null,
      effectiveFrom: new Date(req.body.effectiveFrom),
    },
  });
  try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'utility.rate_create', entity: 'UtilityRate', entityId: rate.id, newValue: req.body }); } catch {}
  res.status(201).json({ rate });
});

router.patch('/rates/:id', write, async (req, res) => {
  if (notMigrated(res)) return;
  const tf = tenantFilter(req);
  const data = {};
  if (req.body.ratePerUnit != null) data.ratePerUnit = Number(req.body.ratePerUnit);
  if (req.body.fixedCharge !== undefined) data.fixedCharge = req.body.fixedCharge == null ? null : Number(req.body.fixedCharge);
  if (req.body.effectiveFrom) data.effectiveFrom = new Date(req.body.effectiveFrom);
  try {
    const rate = await prisma.utilityRate.update({ where: { id: req.params.id }, data: { ...data, tenantId: tf.tenantId } });
    res.json({ rate });
  } catch { res.status(404).json({ error: 'Rate nahi mili' }); }
});

router.delete('/rates/:id', write, async (req, res) => {
  if (notMigrated(res)) return;
  const tf = tenantFilter(req);
  try {
    await prisma.utilityRate.deleteMany({ where: { id: req.params.id, tenantId: tf.tenantId } });
    res.json({ ok: true });
  } catch { res.status(404).json({ error: 'Rate nahi mili' }); }
});

// ---- Generate bills for a period ----
const generateSchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
});

router.post('/generate', write, validateBody(generateSchema), async (req, res) => {
  const tf = tenantFilter(req);
  try {
    const { generateUtilityBills } = require('../lib/utilityBilling');
    const result = await generateUtilityBills(tf.tenantId, req.body.periodStart, req.body.periodEnd, req.user.id);
    if (result.skipped === 'not_migrated') return res.status(503).json({ error: 'Utility billing abhi migrate nahi hui' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Generate fail ho gaya' });
  }
});

// ---- Bills ----
router.get('/bills', async (req, res) => {
  if (notMigrated(res)) return;
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.status) where.status = req.query.status;
  if (req.query.memberId) where.memberId = req.query.memberId;
  if (req.query.meterId) where.meterId = req.query.meterId;
  const bills = await prisma.utilityBill.findMany({
    where,
    include: { meter: { select: { name: true, type: true } }, member: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ bills });
});

router.get('/bills/:id', async (req, res) => {
  if (notMigrated(res)) return;
  const tf = tenantFilter(req);
  const bill = await prisma.utilityBill.findFirst({
    where: { id: req.params.id, ...tf },
    include: { meter: true, member: { select: { id: true, name: true, email: true } }, invoice: { select: { id: true, number: true, status: true } } },
  });
  if (!bill) return res.status(404).json({ error: 'Bill nahi mila' });
  res.json({ bill });
});

// Draft bill ko member assign karke invoice banao
router.post('/bills/:id/to-invoice', write, validateBody(z.object({ memberId: z.string().min(1) })), async (req, res) => {
  const tf = tenantFilter(req);
  try {
    const { billDraftToInvoice } = require('../lib/utilityBilling');
    const result = await billDraftToInvoice(tf.tenantId, req.params.id, req.body.memberId, req.user.id);
    if (result.skipped === 'not_migrated') return res.status(503).json({ error: 'Utility billing abhi migrate nahi hui' });
    if (result.error === 'not_found') return res.status(404).json({ error: 'Bill nahi mila' });
    if (result.error === 'not_draft') return res.status(422).json({ error: 'Sirf draft bill ka invoice ban sakta hai' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Invoice banane me masla' });
  }
});

module.exports = router;
