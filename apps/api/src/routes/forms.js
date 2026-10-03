// Phase 47 Track 1/10: Form Builder — CustomForm CRUD + publish controls.
// Coordinator ke liye:
//   Mount: app.use('/api/forms', require('./routes/forms'));
//   Sidebar: { label: 'Forms & Surveys', path: '/forms' } — roles: ceo/admin/super_admin/manager
// Track 2 (public rendering + submissions) GET /api/forms/public/:slug jodhega —
// yahan public GET public=false forms nahi deta.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

// Model merge na hua ho to safe 503 (koi 500 nahi)
function formsOr503(res) {
  if (!prisma.customForm) {
    res.status(503).json({ error: 'Forms module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.customForm;
}

const FIELD_TYPES = [
  'text', 'textarea', 'number', 'date', 'select', 'multiselect',
  'radio', 'checkbox', 'file', 'rating', 'email', 'phone',
];

const fieldSchema = z.object({
  id: z.string().min(1).max(50),
  type: z.enum(FIELD_TYPES),
  label: z.string().min(1).max(200),
  required: z.boolean().optional().default(false),
  options: z.array(z.string().max(100)).max(50).optional(),
  placeholder: z.string().max(200).optional(),
});

const formSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, 'Slug sirf lowercase, numbers aur dashes'),
  description: z.string().max(2000).optional().nullable(),
  fields: z.array(fieldSchema).max(100).default([]),
  isPublic: z.boolean().optional().default(false),
  status: z.enum(['draft', 'published', 'archived']).optional().default('draft'),
  submitButtonText: z.string().max(60).optional().nullable(),
  successMessage: z.string().max(500).optional().nullable(),
  notifyEmails: z.array(z.string().email()).max(20).optional().nullable(),
  autoCreateLead: z.boolean().optional().default(false),
});

const slugify = (s) =>
  String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

// GET /api/forms — sab forms (status filter ke sath)
router.get('/', async (req, res, next) => {
  try {
    const CF = formsOr503(res); if (!CF) return;
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status) where.status = String(req.query.status);
    const forms = await CF.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { submissions: true } } },
    });
    res.json({ forms: forms.map((f) => ({ ...f, submissionCount: f._count.submissions, _count: undefined })) });
  } catch (e) { next(e); }
});

// GET /api/forms/:id
router.get('/:id', async (req, res, next) => {
  try {
    const CF = formsOr503(res); if (!CF) return;
    const tf = tenantFilter(req);
    const form = await CF.findFirst({
      where: { id: req.params.id, ...tf },
      include: { _count: { select: { submissions: true } } },
    });
    if (!form) return res.status(404).json({ error: 'Form nahi mila.' });
    res.json({ form: { ...form, submissionCount: form._count.submissions, _count: undefined } });
  } catch (e) { next(e); }
});

// POST /api/forms — naya form
router.post('/', async (req, res, next) => {
  try {
    const CF = formsOr503(res); if (!CF) return;
    const tf = tenantFilter(req);
    const data = formSchema.parse(req.body);
    const slug = slugify(data.slug);
    const exists = await CF.findFirst({ where: { tenantId: tf.tenantId, slug } });
    if (exists) return res.status(409).json({ error: 'Is slug ka form pehle se hai.' });
    const form = await CF.create({
      data: { ...data, slug, ...tf, createdById: req.user.id },
    });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'form.create', entity: 'CustomForm', entityId: form.id, newValue: { title: form.title } }); } catch {}
    res.status(201).json({ form });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

// PUT /api/forms/:id — full update (builder save)
router.put('/:id', async (req, res, next) => {
  try {
    const CF = formsOr503(res); if (!CF) return;
    const tf = tenantFilter(req);
    const data = formSchema.parse(req.body);
    const slug = slugify(data.slug);
    const clash = await CF.findFirst({
      where: { tenantId: tf.tenantId, slug, NOT: { id: req.params.id } },
    });
    if (clash) return res.status(409).json({ error: 'Is slug ka doosra form pehle se hai.' });
    const form = await CF.updateMany({
      where: { id: req.params.id, ...tf },
      data: { ...data, slug },
    });
    if (!form.count) return res.status(404).json({ error: 'Form nahi mila.' });
    const updated = await CF.findFirst({ where: { id: req.params.id, ...tf } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'form.update', entity: 'CustomForm', entityId: req.params.id, newValue: { title: data.title } }); } catch {}
    res.json({ form: updated });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

// PATCH /api/forms/:id/publish — publish/unpublish/archive
router.patch('/:id/publish', async (req, res, next) => {
  try {
    const CF = formsOr503(res); if (!CF) return;
    const tf = tenantFilter(req);
    const status = String(req.body.status || '');
    if (!['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Status: draft, published ya archived.' });
    }
    if (status === 'published') {
      const form = await CF.findFirst({ where: { id: req.params.id, ...tf } });
      if (!form) return res.status(404).json({ error: 'Form nahi mila.' });
      if (!Array.isArray(form.fields) || form.fields.length === 0) {
        return res.status(422).json({ error: 'Khali form publish nahi ho sakta — pehle fields joro.' });
      }
    }
    const upd = await CF.updateMany({ where: { id: req.params.id, ...tf }, data: { status } });
    if (!upd.count) return res.status(404).json({ error: 'Form nahi mila.' });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'form.' + status, entity: 'CustomForm', entityId: req.params.id }); } catch {}
    res.json({ ok: true, status });
  } catch (e) { next(e); }
});

// DELETE /api/forms/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const CF = formsOr503(res); if (!CF) return;
    const tf = tenantFilter(req);
    const del = await CF.deleteMany({ where: { id: req.params.id, ...tf } });
    if (!del.count) return res.status(404).json({ error: 'Form nahi mila.' });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'form.delete', entity: 'CustomForm', entityId: req.params.id }); } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Field types list (builder ke liye)
router.get('/meta/field-types', (req, res) => {
  res.json({ types: FIELD_TYPES });
});

module.exports = router;
