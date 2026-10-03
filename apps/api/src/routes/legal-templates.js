// Phase 50 Track 1/10: Contract Template Library API.
// Mount: app.use('/api/legal-templates', require('./routes/legal-templates'));
// Sidebar: Legal section → { label: 'Contract Templates', path: '/legal/templates' } (ceo/admin/super_admin/manager)

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { renderTemplate, extractVariables } = require('../lib/templateRender');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('ceo', 'admin', 'super_admin', 'manager'));

function notMigrated(res) {
  return res.status(503).json({ error: { message: 'Legal templates not migrated yet' } });
}

function hasModel() {
  return prisma && typeof prisma.legalTemplate !== 'undefined';
}

const CATEGORIES = ['membership', 'nda', 'employment', 'vendor', 'event'];

const templateSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.enum(CATEGORIES),
  body: z.string().min(1).max(50000),
  isActive: z.boolean().default(true),
});

const previewSchema = z.object({
  sample: z.record(z.any()).default({}),
});

// List — sirf current versions (archived snapshots nahi), ?category=, ?active=1
router.get('/', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const where = { tenantId: tf.tenantId, isArchived: false };
  if (req.query.category && CATEGORIES.includes(req.query.category)) where.category = req.query.category;
  if (req.query.active === '1') where.isActive = true;
  const list = await prisma.legalTemplate.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, category: true, version: true, isActive: true, variables: true, updatedAt: true },
  });
  res.json({ templates: list });
});

// Detail
router.get('/:id', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const t = await prisma.legalTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });
  res.json({ template: t });
});

// Version history — is template ke archived snapshots
router.get('/:id/versions', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const t = await prisma.legalTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId, isArchived: false },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });
  const versions = await prisma.legalTemplate.findMany({
    where: { tenantId: tf.tenantId, isArchived: true, name: { startsWith: `${t.name} · v` } },
    orderBy: { version: 'desc' },
    select: { id: true, name: true, version: true, createdAt: true },
  });
  res.json({ versions });
});

// Create
router.post('/', validateBody(templateSchema), async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  try {
    const t = await prisma.legalTemplate.create({
      data: {
        tenantId: tf.tenantId,
        name: req.body.name,
        category: req.body.category,
        body: req.body.body,
        variables: extractVariables(req.body.body),
        isActive: req.body.isActive !== false,
      },
    });
    await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'legal_template.create', entity: 'LegalTemplate', entityId: t.id, newValue: { name: t.name, category: t.category } });
    res.status(201).json({ template: t });
  } catch (e) {
    if (e && e.code === 'P2002') {
      return res.status(409).json({ error: { message: 'Is naam ka template pehle se hai' } });
    }
    throw e;
  }
});

// Update — purani version archive hoti hai, version bump hota hai
router.put('/:id', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const patch = templateSchema.partial().parse(req.body);
  const t = await prisma.legalTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId, isArchived: false },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });

  const changed = (patch.body !== undefined && patch.body !== t.body)
    || (patch.name !== undefined && patch.name !== t.name)
    || (patch.category !== undefined && patch.category !== t.category);

  const updated = await prisma.$transaction(async (tx) => {
    if (changed) {
      // Purani version ko snapshot ke tor par archive karo
      await tx.legalTemplate.create({
        data: {
          tenantId: tf.tenantId,
          name: `${t.name} · v${t.version}`,
          category: t.category,
          body: t.body,
          variables: t.variables,
          version: t.version,
          isArchived: true,
          isActive: false,
        },
      });
    }
    const data = { ...patch };
    if (patch.body !== undefined) data.variables = extractVariables(patch.body);
    if (changed) data.version = t.version + 1;
    return tx.legalTemplate.update({ where: { id: t.id }, data });
  });

  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'legal_template.update', entity: 'LegalTemplate', entityId: t.id, oldValue: { version: t.version }, newValue: { version: updated.version, name: updated.name } });
  res.json({ template: updated });
});

// Delete — current + us ke archived snapshots sab
router.delete('/:id', async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const t = await prisma.legalTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId, isArchived: false },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });
  await prisma.legalTemplate.deleteMany({
    where: {
      tenantId: tf.tenantId,
      OR: [{ id: t.id }, { isArchived: true, name: { startsWith: `${t.name} · v` } }],
    },
  });
  await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'legal_template.delete', entity: 'LegalTemplate', entityId: t.id, oldValue: { name: t.name } });
  res.json({ ok: true });
});

// Preview — sample data se render
router.post('/:id/preview', validateBody(previewSchema), async (req, res) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  const t = await prisma.legalTemplate.findFirst({
    where: { id: req.params.id, tenantId: tf.tenantId },
  });
  if (!t) return res.status(404).json({ error: { message: 'Template not found' } });
  res.json({
    preview: {
      body: renderTemplate(t.body, req.body.sample),
      variables: t.variables || [],
    },
  });
});

// Phase 50 Track 5: Template → E-sign flow
const sendSigningSchema = z.object({
  contractId: z.string().min(1),
  signerName: z.string().min(2).max(120),
  signerEmail: z.string().email(),
  data: z.record(z.any()).default({}),
});
router.post('/:id/send-for-signing', validateBody(sendSigningSchema), async (req, res, next) => {
  if (!hasModel()) return notMigrated(res);
  const tf = tenantFilter(req);
  try {
    const r = await require('../lib/templateSign').createFromTemplate({
      tenantId: tf.tenantId,
      templateId: req.params.id,
      data: req.body.data || {},
      signerName: req.body.signerName,
      signerEmail: req.body.signerEmail,
      contractId: req.body.contractId,
      actorId: req.user.id,
      ip: req.ip,
    });
    return res.status(201).json(r);
  } catch (e) {
    if (e && e.statusCode) return res.status(e.statusCode).json({ error: { message: e.message, reason: e.reason } });
    return next(e);
  }
});

module.exports = router;
