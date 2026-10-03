// Phase 50 Track 3: Compliance Checklist
// Mount: app.use('/api/compliance', require('./routes/compliance'));
// Sidebar link nahi — Legal section page (coordinator banaye).
// Coordinator: server.js me ensureComplianceScheduled() wiring.

const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const prisma = require('../lib/prisma');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole(['ceo', 'admin', 'super_admin', 'manager']));

const CATS = ['fire', 'safety', 'license', 'tax', 'data'];
const FREQ = ['once', 'monthly', 'quarterly', 'yearly'];
const STATUS = ['pending', 'done', 'overdue'];

function migrated() { return !!(prisma && prisma.complianceItem); }
const guard = (req, res, next) => migrated() ? next() : res.status(503).json({ ok: false, error: 'Compliance abhi migrate nahi hua' });

const schema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional().nullable(),
  category: z.enum(CATS),
  dueDate: z.string().datetime().optional().nullable(),
  frequency: z.enum(FREQ).default('once'),
  assignedToId: z.string().optional().nullable(),
});

router.get('/', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const { status, category, search } = req.query;
  const where = { ...tf };
  if (status && STATUS.includes(status)) where.status = status;
  if (category && CATS.includes(category)) where.category = category;
  if (search) where.title = { contains: search, mode: 'insensitive' };
  // overdue auto-flag (on-read)
  await prisma.complianceItem.updateMany({ where: { ...tf, status: 'pending', dueDate: { lt: new Date() } }, data: { status: 'overdue' } });
  const items = await prisma.complianceItem.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], include: { assignedTo: { select: { id: true, name: true, email: true } } } });
  res.json({ ok: true, items });
});

router.get('/summary', guard, async (req, res) => {
  const tf = tenantFilter(req);
  await prisma.complianceItem.updateMany({ where: { ...tf, status: 'pending', dueDate: { lt: new Date() } }, data: { status: 'overdue' } });
  const counts = await prisma.complianceItem.groupBy({ by: ['status'], where: tf, _count: true });
  const dueSoon = await prisma.complianceItem.count({ where: { ...tf, status: 'pending', dueDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 864e5) } } });
  res.json({ ok: true, counts, dueSoon });
});

router.post('/', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const p = schema.parse(req.body);
  if (p.assignedToId) {
    const u = await prisma.user.findFirst({ where: { ...tf, id: p.assignedToId } });
    if (!u) return res.status(422).json({ ok: false, error: 'User isi tenant ka nahi' });
  }
  const item = await prisma.complianceItem.create({ data: { ...tf, ...p, dueDate: p.dueDate ? new Date(p.dueDate) : null } });
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'compliance.create', entity: 'ComplianceItem', entityId: item.id, newValue: { title: item.title } }).catch(() => {});
  res.status(201).json({ ok: true, item });
});

router.patch('/:id', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const cur = await prisma.complianceItem.findFirst({ where: { ...tf, id: req.params.id } });
  if (!cur) return res.status(404).json({ ok: false, error: 'Nahi mila' });
  const p = schema.partial().parse(req.body);
  const item = await prisma.complianceItem.update({ where: { id: cur.id }, data: { ...p, dueDate: p.dueDate !== undefined ? (p.dueDate ? new Date(p.dueDate) : null) : undefined } });
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'compliance.update', entity: 'ComplianceItem', entityId: item.id }).catch(() => {});
  res.json({ ok: true, item });
});

router.post('/:id/complete', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const { evidenceUrl } = z.object({ evidenceUrl: z.string().url().max(500).optional().nullable() }).parse(req.body || {});
  const cur = await prisma.complianceItem.findFirst({ where: { ...tf, id: req.params.id } });
  if (!cur) return res.status(404).json({ ok: false, error: 'Nahi mila' });
  const item = await prisma.complianceItem.update({ where: { id: cur.id }, data: { status: 'done', completedAt: new Date(), completedById: req.user.id, evidenceUrl: evidenceUrl ?? cur.evidenceUrl } });
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'compliance.complete', entity: 'ComplianceItem', entityId: item.id }).catch(() => {});
  res.json({ ok: true, item });
});

router.post('/:id/reopen', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const cur = await prisma.complianceItem.findFirst({ where: { ...tf, id: req.params.id } });
  if (!cur) return res.status(404).json({ ok: false, error: 'Nahi mila' });
  const item = await prisma.complianceItem.update({ where: { id: cur.id }, data: { status: 'pending', completedAt: null, completedById: null } });
  res.json({ ok: true, item });
});

router.delete('/:id', guard, async (req, res) => {
  const tf = tenantFilter(req);
  const cur = await prisma.complianceItem.findFirst({ where: { ...tf, id: req.params.id } });
  if (!cur) return res.status(404).json({ ok: false, error: 'Nahi mila' });
  await prisma.complianceItem.delete({ where: { id: cur.id } });
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'compliance.delete', entity: 'ComplianceItem', entityId: cur.id }).catch(() => {});
  res.json({ ok: true });
});

// Overdue auto-flag job (daily) — coordinator: require('./routes/compliance').ensureComplianceScheduled() in server.js
async function flagOverdue() {
  if (!migrated()) return { skipped: 'not_migrated' };
  const r = await prisma.complianceItem.updateMany({ where: { status: 'pending', dueDate: { lt: new Date() } }, data: { status: 'overdue' } });
  return { flagged: r.count };
}
let _sched = false;
function ensureComplianceScheduled() {
  if (_sched) return;
  _sched = true;
  setTimeout(async () => { try { await flagOverdue(); } catch {} ensureComplianceScheduled(); }, 24 * 3600 * 1000);
}
module.exports = router;
module.exports.ensureComplianceScheduled = ensureComplianceScheduled;
module.exports.flagOverdue = flagOverdue;
