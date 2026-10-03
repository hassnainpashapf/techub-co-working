/**
 * Phase 52 Track 7 — Report Templates Library
 * GET  /api/report-templates          — template gallery
 * POST /api/report-templates/:key/clone — template se saved CustomReport banao
 *
 * Builder integration (Track 2 owns apps/web/app/(app)/reports/builder/[id]/page.js):
 * - "📊 Template se shuru karein" gallery: GET /api/report-templates se cards
 *   (title, titleUr, description, entity, columnCount)
 * - "Use template" -> POST /api/report-templates/:key/clone { name? }
 *   -> 201 { id } -> builder page /reports/builder/<id> par redirect
 *
 * Mount (coordinator): app.use('/api/report-templates', require('./routes/report-templates'));
 * Sidebar link nahi — builder extend hai.
 */
const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { getTemplates, getTemplate, toReportPayload } = require('../lib/reportTemplates');

const router = express.Router();
router.use(authenticate, requireTenantUser);

/** CustomReport model merge hua ya nahi — graceful 503 */
function guardMigrated(req, res, next) {
  const prisma = require('../lib/prisma');
  if (!prisma.customReport) {
    return res.status(503).json({ error: 'Reports module abhi migrate nahi hua' });
  }
  req.prisma = prisma;
  next();
}
router.use(guardMigrated);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

router.get('/', requireRole(...STAFF), (req, res) => {
  res.json({ templates: getTemplates() });
});

const cloneSchema = z.object({
  name: z.string().min(2).max(120).optional(),
});

router.post('/:key/clone', requireRole(...STAFF), async (req, res) => {
  const template = getTemplate(req.params.key);
  if (!template) return res.status(404).json({ error: 'Template nahi mila' });

  const parsed = cloneSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Ghalat input', details: parsed.error.issues });

  const tf = tenantFilter(req);
  const payload = toReportPayload(template, {
    tenantId: tf.tenantId,
    ownerId: req.user.id,
    name: parsed.data.name,
  });

  // Naam unique rakho (same naam dobara clone ho to suffix)
  let finalName = payload.name;
  let n = 2;
  while (await req.prisma.customReport.findFirst({ where: { ...tf, name: finalName } })) {
    finalName = `${payload.name} (${n++})`;
  }
  payload.name = finalName;

  const report = await req.prisma.customReport.create({ data: payload });

  await writeAudit({
    tenantId: tf.tenantId,
    actorId: req.user.id,
    action: 'custom_report.clone_template',
    entity: 'CustomReport',
    entityId: report.id,
    newValue: { templateKey: template.key, name: report.name },
  }).catch(() => {});

  res.status(201).json({ id: report.id, name: report.name, entity: report.entity });
});

module.exports = router;
