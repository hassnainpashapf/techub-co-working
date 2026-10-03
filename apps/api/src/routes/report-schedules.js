// Phase 52 Track 4: Scheduled delivery for custom reports — CRUD + send-now.
// Mount (coordinator): app.use('/api/report-schedules', require('./routes/report-schedules'));
const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const prisma = require('../lib/prisma');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'manager'));

function notMigrated(res) {
  return res.status(503).json({ ok: false, error: 'custom_reports_not_migrated' });
}

const emailSchema = z.string().email().max(160);
const scheduleSchema = z.object({
  reportId: z.string().min(1),
  frequency: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  recipients: z.array(emailSchema).min(1).max(50),
  format: z.enum(['csv', 'pdf']).default('pdf'),
  isActive: z.boolean().optional(),
});
const updateSchema = scheduleSchema.partial().omit({ reportId: true });

// GET /api/report-schedules — list (report name join)
router.get('/', async (req, res) => {
  try {
    if (!prisma.reportSchedule) return notMigrated(res);
    const tf = tenantFilter(req);
    const { active } = req.query;
    const schedules = await prisma.reportSchedule.findMany({
      where: { ...tf, ...(active !== undefined ? { isActive: active === '1' } : {}) },
      include: { report: { select: { id: true, name: true, entity: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, schedules });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/report-schedules — create
router.post('/', async (req, res) => {
  try {
    if (!prisma.reportSchedule) return notMigrated(res);
    const tf = tenantFilter(req);
    const body = scheduleSchema.parse(req.body);
    const report = await prisma.customReport.findFirst({
      where: { id: body.reportId, ...tf },
    });
    if (!report) return res.status(404).json({ ok: false, error: 'report_not_found' });
    const schedule = await prisma.reportSchedule.create({
      data: {
        ...tf,
        reportId: report.id,
        frequency: body.frequency,
        dayOfWeek: body.dayOfWeek ?? (body.frequency === 'weekly' ? 1 : null),
        dayOfMonth: body.dayOfMonth ?? (body.frequency === 'monthly' ? 1 : null),
        recipients: body.recipients,
        format: body.format,
        isActive: body.isActive ?? true,
        createdBy: req.user?.id || null,
      },
      include: { report: { select: { id: true, name: true, entity: true } } },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user?.id || null, action: 'report_schedule.create',
      entity: 'report_schedule', entityId: schedule.id,
      newValue: { reportId: report.id, frequency: body.frequency, format: body.format },
    }).catch(() => {});
    res.status(201).json({ ok: true, schedule });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(422).json({ ok: false, error: 'validation', details: e.errors });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PATCH /api/report-schedules/:id — update
router.patch('/:id', async (req, res) => {
  try {
    if (!prisma.reportSchedule) return notMigrated(res);
    const tf = tenantFilter(req);
    const body = updateSchema.parse(req.body);
    const existing = await prisma.reportSchedule.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
    const schedule = await prisma.reportSchedule.update({
      where: { id: req.params.id },
      data: {
        ...(body.frequency ? { frequency: body.frequency } : {}),
        ...(body.dayOfWeek !== undefined ? { dayOfWeek: body.dayOfWeek } : {}),
        ...(body.dayOfMonth !== undefined ? { dayOfMonth: body.dayOfMonth } : {}),
        ...(body.recipients ? { recipients: body.recipients } : {}),
        ...(body.format ? { format: body.format } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user?.id || null, action: 'report_schedule.update',
      entity: 'report_schedule', entityId: schedule.id, newValue: body,
    }).catch(() => {});
    res.json({ ok: true, schedule });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(422).json({ ok: false, error: 'validation', details: e.errors });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/report-schedules/:id
router.delete('/:id', async (req, res) => {
  try {
    if (!prisma.reportSchedule) return notMigrated(res);
    const tf = tenantFilter(req);
    const existing = await prisma.reportSchedule.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
    await prisma.reportSchedule.delete({ where: { id: req.params.id } });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user?.id || null, action: 'report_schedule.delete',
      entity: 'report_schedule', entityId: req.params.id,
    }).catch(() => {});
    res.json({ ok: true, deleted: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/report-schedules/:id/send-now — foran bheje (test/manual trigger)
router.post('/:id/send-now', async (req, res) => {
  try {
    if (!prisma.reportSchedule) return notMigrated(res);
    const tf = tenantFilter(req);
    const existing = await prisma.reportSchedule.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
    const { sendScheduleNow } = require('../lib/reportScheduler');
    const result = await sendScheduleNow(req.params.id, req.user?.id || null);
    if (result.error) return res.status(422).json({ ok: false, ...result });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/report-schedules/run-due — manual scheduler trigger (ceo/admin)
router.post('/run-due', requireRole('ceo', 'admin'), async (req, res) => {
  try {
    const { runDueSchedules } = require('../lib/reportScheduler');
    const result = await runDueSchedules();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
