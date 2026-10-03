// Phase 30 Track 5: Email template editor — per-tenant custom templates.
// Phase 38 Track 3: extended with preview / test / seed endpoints.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { listBuiltinTemplates, renderCustom, sendEmail } = require('../lib/mailer');
const { getDefaultTemplate, sampleDataFor } = require('../lib/emailTemplateDefaults');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const ADMIN_ROLES = ['ceo', 'admin', 'super_admin'];
const adminWrite = requireRole(...ADMIN_ROLES);

function auditWrite(req, action, key) {
  return writeAudit({
    tenantId: req.user.tenantId, actorId: req.user.sub, action,
    entity: 'EmailTemplate', newValue: { key },
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// Effective template for a tenant: DB override if present, else the
// built-in default in {{variable}} form.
async function effectiveTemplate(tenantId, key) {
  const def = getDefaultTemplate(key);
  if (!def) return null;
  let row = null;
  try {
    row = await prisma.emailTemplate.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
  } catch { /* table may not exist yet — fall back to default */ }
  if (row) {
    return {
      key, custom: true, isCustom: !!row.isCustom, isActive: row.isActive,
      subject: row.subject, htmlBody: row.htmlBody, variables: def.variables,
      updatedAt: row.updatedAt,
    };
  }
  return { ...def, custom: false };
}

// List custom templates + available built-in keys
router.get('/', async (req, res, next) => {
  try {
    let templates = [];
    try {
      templates = await prisma.emailTemplate.findMany({
        where: { ...tenantFilter(req) },
        select: { key: true, isCustom: true, isActive: true, updatedAt: true },
        orderBy: { key: 'asc' },
      });
    } catch { /* table pending */ }
    res.json({ templates, builtins: listBuiltinTemplates() });
  } catch (e) { next(e); }
});

// Seed built-in defaults into the tenant (idempotent — only missing keys).
router.post('/seed', adminWrite, async (req, res, next) => {
  try {
    const keys = (listBuiltinTemplates() || []).map((b) => b.key);
    let created = 0;
    for (const key of keys) {
      const def = getDefaultTemplate(key);
      if (!def) continue;
      const existing = await prisma.emailTemplate.findUnique({
        where: { tenantId_key: { tenantId: req.user.tenantId, key } },
        select: { id: true },
      });
      if (!existing) {
        await prisma.emailTemplate.create({
          data: {
            tenantId: req.user.tenantId, key, subject: def.subject,
            htmlBody: def.htmlBody, variables: def.variables, isCustom: false, isActive: true,
          },
        });
        created += 1;
      }
    }
    await auditWrite(req, 'email_template.seed', `${created} new`);
    res.json({ ok: true, created, total: keys.length });
  } catch (e) { next(e); }
});

// Preview: render a template (saved or ad-hoc) with sample data.
const previewSchema = z.object({
  key: z.string().min(1).max(100),
  subject: z.string().min(1).max(300).optional(),
  htmlBody: z.string().min(1).max(200000).optional(),
});

router.post('/preview', validateBody(previewSchema), async (req, res, next) => {
  try {
    const { key, subject, htmlBody } = req.body;
    const tpl = await effectiveTemplate(req.user.tenantId, key);
    if (!tpl) return res.status(404).json({ error: { message: 'Unknown template key.' } });
    const data = sampleDataFor(tpl.variables);
    const rendered = renderCustom({ subject: subject || tpl.subject, htmlBody: htmlBody || tpl.htmlBody }, data);
    res.json({ key, subject: rendered.subject, html: rendered.html, sampleData: data });
  } catch (e) { next(e); }
});

// Get one template — custom if saved, else the built-in default
router.get('/:key', async (req, res, next) => {
  try {
    const tpl = await effectiveTemplate(req.user.tenantId, req.params.key);
    if (!tpl) return res.status(404).json({ error: { message: 'Unknown template key.' } });
    res.json({ ...tpl, note: tpl.custom ? undefined : 'Showing built-in default. Save to create a custom override.' });
  } catch (e) { next(e); }
});

const upsertSchema = z.object({
  subject: z.string().min(1).max(200),
  htmlBody: z.string().min(1).max(50000),
  isActive: z.boolean().optional(),
});

// Create/update a custom template (marks isCustom = true)
router.put('/:key', adminWrite, validateBody(upsertSchema), async (req, res, next) => {
  try {
    const { key } = req.params;
    const def = getDefaultTemplate(key);
    if (!def) return res.status(400).json({ error: { message: 'Unknown template key.' } });
    const { subject, htmlBody, isActive = true } = req.body;
    const tpl = await prisma.emailTemplate.upsert({
      where: { tenantId_key: { tenantId: req.user.tenantId, key } },
      update: { subject, htmlBody, variables: def.variables, isCustom: true, isActive },
      create: {
        tenantId: req.user.tenantId, key, subject, htmlBody,
        variables: def.variables, isCustom: true, isActive,
      },
    });
    await auditWrite(req, 'email_template.saved', key);
    res.json({ template: tpl });
  } catch (e) { next(e); }
});

// Send a test email using the effective template + sample data
const testSchema = z.object({ email: z.string().email() });

router.post('/:key/test', adminWrite, validateBody(testSchema), async (req, res, next) => {
  try {
    const tpl = await effectiveTemplate(req.user.tenantId, req.params.key);
    if (!tpl) return res.status(404).json({ error: { message: 'Unknown template key.' } });
    const data = sampleDataFor(tpl.variables);
    const rendered = renderCustom({ subject: tpl.subject, htmlBody: tpl.htmlBody }, data);
    const result = await sendEmail(req.user.tenantId, {
      to: req.body.email,
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
    });
    await auditWrite(req, 'email_template.test', req.params.key);
    res.json({ ok: result.sent, reason: result.reason || null });
  } catch (e) { next(e); }
});

// Reset to built-in default (deletes the custom override)
router.delete('/:key', adminWrite, async (req, res, next) => {
  try {
    await prisma.emailTemplate.deleteMany({
      where: { ...tenantFilter(req), key: req.params.key },
    });
    await auditWrite(req, 'email_template.reset', req.params.key);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
