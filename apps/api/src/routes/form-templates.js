// Phase 47 Track 6/10: Form Templates Library API.
// Mount: app.use('/api/form-templates', require('./routes/form-templates'));
// Sidebar link: nahi — form builder me "Template se shuru karein" gallery
// (Track 1 owns apps/web/app/(app)/forms/[id]/page.js — wahan GET /api/form-templates
// se gallery + POST /:key/clone se naya draft banao).
// Koi migration nahi — templates seed lib me hain, clone CustomForm row banata hai.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { listTemplates, getTemplate } = require('../lib/formTemplates');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

// Merge se pehle graceful 503 (koi 500 crash nahi)
router.use((req, res, next) => {
  if (!prisma.customForm) return res.status(503).json({ error: 'Forms not migrated yet' });
  next();
});

// GET / — template gallery (title, description, category, fieldCount + preview fields)
router.get('/', async (req, res, next) => {
  try {
    const templates = listTemplates().map(t => {
      const full = getTemplate(t.key);
      return { ...t, fields: full.fields() };
    });
    res.json({ templates });
  } catch (e) { next(e); }
});

// POST /:key/clone — template se naya CustomForm draft
router.post('/:key/clone', async (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().min(1).max(120).optional(),
      isPublic: z.boolean().optional().default(false),
    });
    const { title, isPublic } = schema.parse(req.body || {});
    const tf = tenantFilter(req);
    const tpl = getTemplate(req.params.key);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    // Slug uniquify: template-key, template-key-2, ...
    const base = `${tpl.key}`;
    let slug = base, n = 1;
    while (await prisma.customForm.findUnique({ where: { tenantId_slug: { tenantId: tf.tenantId, slug } } })) {
      n += 1;
      slug = `${base}-${n}`;
    }

    const form = await prisma.customForm.create({
      data: {
        tenantId: tf.tenantId,
        title: title || tpl.title,
        slug,
        description: tpl.description,
        fields: tpl.fields(),
        isPublic,
        status: 'draft',
        createdById: req.user.id,
      },
    });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'form.clone_template', entity: 'CustomForm', entityId: form.id, newValue: { template: tpl.key } }); } catch {}
    res.status(201).json({ form });
  } catch (e) { next(e); }
});

module.exports = router;
