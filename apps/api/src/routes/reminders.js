// Phase 38 Track 10: Smart Reminders Engine — API.
// Mount: app.use('/api/reminders', require('./routes/reminders')); (coordinator)
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { ENTITIES, CHANNELS, ENTITY_LABELS, runReminderEngine } = require('../lib/reminders');

const router = express.Router();

function modelsReady(res) {
  if (!(prisma.reminderRule && prisma.reminderLog)) {
    res.status(503).json({ error: 'Reminders not available yet (migration pending)' });
    return false;
  }
  return true;
}

router.use(authenticate, requireTenantUser);
const staffOnly = requireRole('ceo', 'admin', 'super_admin', 'manager');

const ruleSchema = z.object({
  name: z.string().min(1).max(200),
  entity: z.enum(ENTITIES),
  timing: z.enum(['before', 'after']),
  daysOffset: z.number().int().min(0).max(365),
  channels: z.array(z.enum(CHANNELS)).min(1).max(3),
  templateKey: z.string().min(1).max(120).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

// GET / — list rules with last-sent info
router.get('/', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const rules = await prisma.reminderRule.findMany({
      where: { tenantId: tf.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    const lastLogs = await prisma.reminderLog.groupBy({
      by: ['ruleId'],
      where: { tenantId: tf.tenantId },
      _max: { sentAt: true },
      _count: { id: true },
    });
    const lastMap = new Map(lastLogs.map((l) => [l.ruleId, { lastSentAt: l._max.sentAt, totalSent: l._count.id }]));
    res.json({
      entities: ENTITIES.map((e) => ({ key: e, label: ENTITY_LABELS[e] })),
      channels: CHANNELS,
      rules: rules.map((r) => ({
        ...r,
        lastSentAt: lastMap.get(r.id)?.lastSentAt || null,
        totalSent: lastMap.get(r.id)?.totalSent || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST / — create rule
router.post('/', staffOnly, validateBody(ruleSchema), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const r = await prisma.reminderRule.create({
      data: { ...req.body, tenantId: tf.tenantId, createdById: req.user.sub },
    });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'reminder.created', entity: 'ReminderRule', entityId: r.id });
    res.status(201).json({ rule: r });
  } catch (err) {
    next(err);
  }
});

// PATCH /:id — update rule (incl. isActive toggle)
router.patch('/:id', staffOnly, validateBody(ruleSchema.partial()), async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const existing = await prisma.reminderRule.findFirst({ where: { id: req.params.id, tenantId: tf.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Rule not found' });
    const r = await prisma.reminderRule.update({ where: { id: existing.id }, data: req.body });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'reminder.updated', entity: 'ReminderRule', entityId: r.id });
    res.json({ rule: r });
  } catch (err) {
    next(err);
  }
});

// DELETE /:id — delete rule (logs cascade)
router.delete('/:id', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const existing = await prisma.reminderRule.findFirst({ where: { id: req.params.id, tenantId: tf.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Rule not found' });
    await prisma.reminderRule.delete({ where: { id: existing.id } });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'reminder.deleted', entity: 'ReminderRule', entityId: existing.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /:id/test — dry-run preview: how many would be reminded right now
router.post('/:id/test', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const rule = await prisma.reminderRule.findFirst({ where: { id: req.params.id, tenantId: tf.tenantId } });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    const result = await runReminderEngine(tf.tenantId, { dryRun: true });
    if (!result.ok) return res.status(503).json({ error: result.error });
    const mine = result.results.find((r) => r.ruleId === rule.id);
    res.json(mine || { ruleId: rule.id, count: 0, sample: [] });
  } catch (err) {
    next(err);
  }
});

// POST /run — enqueue the engine for this tenant right now
router.post('/run', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const jobs = require('../lib/jobs');
    const job = await jobs.enqueue('reminders', {}, { tenantId: tf.tenantId });
    writeAudit({ tenantId: tf.tenantId, actorId: req.user.sub, action: 'reminder.run', entity: 'Job', entityId: job.id });
    res.json({ ok: true, jobId: job.id });
  } catch (err) {
    next(err);
  }
});

// GET /logs — recent sends
router.get('/logs', staffOnly, async (req, res, next) => {
  try {
    if (!modelsReady(res)) return;
    const tf = tenantFilter(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const logs = await prisma.reminderLog.findMany({
      where: { tenantId: tf.tenantId },
      include: { rule: { select: { name: true, entity: true } } },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
