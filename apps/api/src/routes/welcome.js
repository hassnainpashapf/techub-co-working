// Phase 54 Track 3/10: Welcome sequences CRUD + manual run.
// Mount (coordinator): app.use('/api/welcome', require('./routes/welcome').router);
// server.js / Sidebar.js nahi chhue. Koi migration nahi (fragment welcome-sequences.prisma).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
router.use(authenticate, requireTenantUser);

function welcomeEnabled() {
  return !!(prisma && prisma.welcomeSequence && prisma.welcomeLog && prisma.member);
}
function guard503(req, res, next) {
  if (!welcomeEnabled()) return res.status(503).json({ error: 'Welcome automation schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'WelcomeSequence', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const stepSchema = z.object({
  dayOffset: z.number().int().min(0).max(365),
  channel: z.enum(['email', 'sms', 'whatsapp']),
  templateId: z.string().optional().nullable(),
  subject: z.string().max(200).optional().nullable(),
});
const seqSchema = z.object({
  name: z.string().min(2).max(120),
  steps: z.array(stepSchema).min(1).max(30),
  isActive: z.boolean().optional(),
});
const seqUpdateSchema = seqSchema.partial();

// GET /api/welcome — sab sequences (staff)
router.get('/', requireRole(...STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const items = await prisma.welcomeSequence.findMany({
    where: { ...tf },
    include: { _count: { select: { logs: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items });
});

// GET /api/welcome/:id — sequence + steps + recent logs
router.get('/:id', requireRole(...STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const item = await prisma.welcomeSequence.findFirst({
    where: { id: req.params.id, ...tf },
    include: { logs: { orderBy: { sentAt: 'desc' }, take: 50, include: { member: { select: { name: true, email: true } } } } },
  });
  if (!item) return res.status(404).json({ error: 'Sequence not found' });
  res.json({ item });
});

// POST /api/welcome — naya sequence
router.post('/', requireRole(...STAFF), validateBody(seqSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const item = await prisma.welcomeSequence.create({
    data: { ...tf, name: req.body.name, steps: req.body.steps, isActive: req.body.isActive ?? true, createdBy: req.user.sub },
  });
  audit(req, tf, 'welcome.sequence_create', item.id, { name: item.name });
  res.status(201).json({ item });
});

// PATCH /api/welcome/:id — edit / activate / deactivate
router.patch('/:id', requireRole(...STAFF), validateBody(seqUpdateSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const exists = await prisma.welcomeSequence.findFirst({ where: { id: req.params.id, ...tf } });
  if (!exists) return res.status(404).json({ error: 'Sequence not found' });
  const item = await prisma.welcomeSequence.update({ where: { id: exists.id }, data: req.body });
  audit(req, tf, 'welcome.sequence_update', item.id, req.body);
  res.json({ item });
});

// DELETE /api/welcome/:id — delete (logs cascade)
router.delete('/:id', requireRole('ceo', 'admin', 'super_admin'), async (req, res) => {
  const tf = tenantFilter(req);
  const exists = await prisma.welcomeSequence.findFirst({ where: { id: req.params.id, ...tf } });
  if (!exists) return res.status(404).json({ error: 'Sequence not found' });
  await prisma.welcomeSequence.delete({ where: { id: exists.id } });
  audit(req, tf, 'welcome.sequence_delete', exists.id, null);
  res.json({ ok: true });
});

// POST /api/welcome/run-due — manual global scan (scheduler trigger)
// NOTE: ye route `/:id` wali routes se PEHLE defined hai taake "run-due" :id me na phanse.
router.post('/run-due', requireRole('ceo', 'admin', 'super_admin'), async (req, res) => {
  const { runWelcomeSequences } = require('../lib/welcomeAutomation');
  const out = await runWelcomeSequences();
  res.json({ ok: true, result: out });
});

// POST /api/welcome/:id/run-now — foran scan (sirf is sequence)
router.post('/:id/run-now', requireRole(...STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const seq = await prisma.welcomeSequence.findFirst({ where: { id: req.params.id, ...tf } });
  if (!seq) return res.status(404).json({ error: 'Sequence not found' });
  const { runWelcomeSequences } = require('../lib/welcomeAutomation');
  const out = await runWelcomeSequences();
  audit(req, tf, 'welcome.sequence_manual_run', seq.id, out);
  res.json({ ok: true, result: out });
});

module.exports = { router };
