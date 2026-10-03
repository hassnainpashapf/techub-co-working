// Phase 38 Track 1: Scheduled Report Emails — CRUD + send-now.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

function modelsReady(res) {
  if (!prisma.scheduledReport) {
    res.status(503).json({ error: 'Scheduled reports not available yet (migration pending)' });
    return false;
  }
  return true;
}

router.use(authenticate, requireTenantUser);
const adminOnly = requireRole('ceo', 'admin', 'super_admin');

const REPORT_TYPES = ['occupancy', 'revenue', 'expenses', 'churn', 'pnl'];

const reportSchema = z.object({
  name: z.string().min(1).max(200),
  reportType: z.enum(REPORT_TYPES),
  frequency: z.enum(['weekly', 'monthly']).default('weekly'),
  dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
  dayOfMonth: z.number().int().min(1).max(28).optional().nullable(),
  recipients: z.array(z.string().email()).min(1).max(20),
  format: z.enum(['pdf', 'csv']).default('pdf'),
  isActive: z.boolean().default(true),
});

// GET / — list
router.get('/', adminOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const rows = await prisma.scheduledReport.findMany({
      where: tenantFilter(req),
      orderBy: { createdAt: 'desc' },
    });
    res.json({ reports: rows });
  } catch (err) { next(err); }
});

// POST / — create
router.post('/', adminOnly, validateBody(reportSchema), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const row = await prisma.scheduledReport.create({
      data: {
        ...tenantFilter(req),
        name: req.body.name,
        reportType: req.body.reportType,
        frequency: req.body.frequency,
        dayOfWeek: req.body.dayOfWeek ?? null,
        dayOfMonth: req.body.dayOfMonth ?? null,
        recipients: req.body.recipients,
        format: req.body.format,
        isActive: req.body.isActive,
        createdBy: req.user.id,
      },
    });
    writeAudit(req, 'scheduled-report.create', { id: row.id, name: row.name }).catch(() => {});
    res.status(201).json({ report: row });
  } catch (err) { next(err); }
});

// PATCH /:id — update
router.patch('/:id', adminOnly, validateBody(reportSchema.partial()), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const existing = await prisma.scheduledReport.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    const row = await prisma.scheduledReport.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name !== undefined && { name: req.body.name }),
        ...(req.body.reportType !== undefined && { reportType: req.body.reportType }),
        ...(req.body.frequency !== undefined && { frequency: req.body.frequency }),
        ...(req.body.dayOfWeek !== undefined && { dayOfWeek: req.body.dayOfWeek }),
        ...(req.body.dayOfMonth !== undefined && { dayOfMonth: req.body.dayOfMonth }),
        ...(req.body.recipients !== undefined && { recipients: req.body.recipients }),
        ...(req.body.format !== undefined && { format: req.body.format }),
        ...(req.body.isActive !== undefined && { isActive: req.body.isActive }),
      },
    });
    writeAudit(req, 'scheduled-report.update', { id: row.id }).catch(() => {});
    res.json({ report: row });
  } catch (err) { next(err); }
});

// DELETE /:id
router.delete('/:id', adminOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const existing = await prisma.scheduledReport.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    await prisma.scheduledReport.delete({ where: { id: existing.id } });
    writeAudit(req, 'scheduled-report.delete', { id: existing.id }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /:id/send-now — enqueue immediate send
router.post('/:id/send-now', adminOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const existing = await prisma.scheduledReport.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    const { enqueue } = require('../lib/jobs');
    await enqueue('scheduled-report-send', { reportId: existing.id }, { tenantId: existing.tenantId });
    writeAudit(req, 'scheduled-report.send-now', { id: existing.id }).catch(() => {});
    res.json({ ok: true, queued: true });
  } catch (err) { next(err); }
});

module.exports = router;
