// Phase 49 Track 6: Cross-channel message templates API.
// Mount: app.use('/api/comms-templates', require('./routes/comms-templates'));
// Sidebar link nahi — comms composer (Track 1) me template picker jure ga.
// Integration note (Track 1 composer): template select karne par
//   GET /api/comms-templates/:id → body/subject form me prefill karo,
//   send se pehle POST /api/comms-templates/:id/preview {sample} se render dekho.

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { renderTemplate, extractVariables } = require('../lib/templateRender');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('ceo', 'admin', 'super_admin', 'manager'));

function notMigrated(res) {
  return res.status(503).json({ error: { message: 'Comm templates not migrated yet' } });
}

function hasModel() {
  return prisma && typeof prisma.commTemplate !== 'undefined';
}

const CHANNELS = ['any', 'email', 'sms', 'whatsapp', 'internal'];

const templateSchema = z.object({
  name: z.string().min(2).max(120),
  channel: z.enum(CHANNELS).default('any'),
  subject: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(5000),
  isActive: z.boolean().default(true),
});

const previewSchema = z.object({
  sample: z.record(z.any()).default({}),
});

// List — ?channel= filter, ?active=1
router.get('/', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const where = { tenantId: tf.tenantId };
  if (req.query.channel && CHANNELS.includes(req.query.channel)) {
    where.OR = [{ channel: 'any' }, { channel: req.query.channel }];
  }
  if (req.query.active === '1') where.isActive = true;
  const list = await prisma.commTemplate.findMany({
    where,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, channel: true, subject: true, isActive: true, variables: true, updatedAt: true },
  });
  res.json({ templates: list });
});

// Detail
router.get('/:id', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const t = await prisma.commTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });
  res.json({ template: t });
});

// Create — variables body se auto-extract
router.post('/', validateBody(templateSchema), async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  try {
    const t = await prisma.commTemplate.create({
      data: {
        tenantId: tf.tenantId,
        name: req.body.name,
        channel: req.body.channel || 'any',
        subject: req.body.subject || null,
        body: req.body.body,
        variables: extractVariables(req.body.body),
        isActive: req.body.isActive !== false,
      },
    });
    res.status(201).json({ template: t });
  } catch (e) {
    if (e && e.code === 'P2002') {
      return res.status(409).json({ error: { message: 'Is naam ka template pehle se hai' } });
    }
    throw e;
  }
});

// Update — body badle to variables dobara extract
router.patch('/:id', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const t = await prisma.commTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });
  const patch = templateSchema.partial().parse(req.body);
  if (patch.body !== undefined) patch.variables = extractVariables(patch.body);
  const updated = await prisma.commTemplate.update({ where: { id: t.id }, data: patch });
  res.json({ template: updated });
});

// Delete
router.delete('/:id', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const t = await prisma.commTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });
  await prisma.commTemplate.delete({ where: { id: t.id } });
  res.json({ ok: true });
});

// Preview — sample data se render (missing vars graceful khali)
router.post('/:id/preview', validateBody(previewSchema), async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const t = await prisma.commTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });
  res.json({
    preview: {
      subject: t.subject ? renderTemplate(t.subject, req.body.sample) : null,
      body: renderTemplate(t.body, req.body.sample),
      variables: t.variables || [],
    },
  });
});

module.exports = router;
