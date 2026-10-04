// Phase 54 Track 1/10: Member Success — Onboarding Journeys API.
// Mount (coordinator): app.use('/api/member-journeys', require('./routes/member-journeys').router);
// NOTE: /api/onboarding pehle se Phase 35 (tenant wizard) me mounted hai — is liye alag path.
// NOTE: exports ensureJourneyForMember(prisma, tenantId, memberId) — coordinator member
// signup/create route me wire kare taake naye member ki journey auto-start ho.
// server.js / Sidebar.js nahi chhue.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const router = express.Router();
router.use(authenticate, requireTenantUser);

function journeysEnabled() {
  return !!(prisma && prisma.memberJourneyTemplate && prisma.memberJourney && prisma.member);
}
function guard503(req, res, next) {
  if (!journeysEnabled()) return res.status(503).json({ error: 'Onboarding journeys schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'MemberJourney', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const stageSchema = z.object({
  title: z.string().min(1).max(120),
  dayOffset: z.number().int().min(0).default(0),
  tasks: z.array(z.string().min(1).max(200)).max(30).default([]),
});
const templateSchema = z.object({
  name: z.string().min(1).max(120),
  stages: z.array(stageSchema).min(1).max(12),
  isDefault: z.boolean().optional(),
});

// ---- helpers ----
function blankStageTasks(stages) {
  return (Array.isArray(stages) ? stages : []).map((s) => ((s.tasks || []).map(() => false)));
}
function progressOf(stageTasks) {
  let total = 0, done = 0;
  for (const st of (stageTasks || [])) for (const t of (st || [])) { total++; if (t) done++; }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}
function resolveStage(stageTasks) {
  const arr = stageTasks || [];
  for (let i = 0; i < arr.length; i++) {
    if ((arr[i] || []).some((t) => !t)) return i;
  }
  return arr.length; // sab complete
}

async function ensureJourneyForMember(prismaClient, tenantId, memberId, templateId) {
  const existing = await prismaClient.memberJourney.findFirst({
    where: { tenantId, memberId, status: 'active' },
  });
  if (existing) return { journey: existing, created: false };
  let template = null;
  if (templateId) {
    template = await prismaClient.memberJourneyTemplate.findFirst({ where: { id: templateId, tenantId } });
  } else {
    template = await prismaClient.memberJourneyTemplate.findFirst({ where: { tenantId, isDefault: true } });
  }
  if (!template) return { journey: null, created: false };
  const stages = Array.isArray(template.stages) ? template.stages : [];
  const journey = await prismaClient.memberJourney.create({
    data: {
      tenantId, memberId, templateId: template.id, templateName: template.name,
      stageTasks: blankStageTasks(stages), currentStage: 0, status: 'active',
    },
  });
  return { journey, created: true };
}

// ================= Templates (staff) =================
router.get('/templates', requireRole(...STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const templates = await prisma.memberJourneyTemplate.findMany({
    where: tf, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { journeys: true } } },
  });
  res.json({ templates });
});

router.post('/templates', requireRole(...STAFF), validateBody(templateSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const { name, stages, isDefault } = req.body;
  const created = await prisma.$transaction(async (tx) => {
    if (isDefault) await tx.memberJourneyTemplate.updateMany({ where: { ...tf, isDefault: true }, data: { isDefault: false } });
    return tx.memberJourneyTemplate.create({ data: { ...tf, name, stages, isDefault: !!isDefault } });
  });
  audit(req, tf, 'onboarding.template_created', created.id, { name });
  res.status(201).json({ template: created });
});

router.put('/templates/:id', requireRole(...STAFF), validateBody(templateSchema.partial()), async (req, res) => {
  const tf = tenantFilter(req);
  const existing = await prisma.memberJourneyTemplate.findFirst({ where: { id: req.params.id, ...tf } });
  if (!existing) return res.status(404).json({ error: 'Template nahi mila' });
  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.stages !== undefined) data.stages = req.body.stages;
  if (req.body.isDefault !== undefined) data.isDefault = !!req.body.isDefault;
  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault) await tx.memberJourneyTemplate.updateMany({ where: { ...tf, isDefault: true }, data: { isDefault: false } });
    return tx.memberJourneyTemplate.update({ where: { id: existing.id }, data });
  });
  audit(req, tf, 'onboarding.template_updated', updated.id, { name: updated.name });
  res.json({ template: updated });
});

router.delete('/templates/:id', requireRole(...STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const existing = await prisma.memberJourneyTemplate.findFirst({ where: { id: req.params.id, ...tf } });
  if (!existing) return res.status(404).json({ error: 'Template nahi mila' });
  await prisma.memberJourneyTemplate.delete({ where: { id: existing.id } });
  audit(req, tf, 'onboarding.template_deleted', existing.id, { name: existing.name });
  res.json({ ok: true });
});

// ================= Journeys (staff) =================
router.get('/journeys', requireRole(...STAFF, 'reception'), async (req, res) => {
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.status) where.status = String(req.query.status);
  const journeys = await prisma.memberJourney.findMany({
    where, orderBy: [{ startedAt: 'desc' }], take: 200,
    include: { member: { select: { id: true, name: true, email: true } } },
  });
  res.json({ journeys: journeys.map((j) => ({ ...j, progress: progressOf(j.stageTasks) })) });
});

const assignSchema = z.object({ memberId: z.string().min(1), templateId: z.string().optional() });

router.post('/journeys', requireRole(...STAFF, 'reception'), validateBody(assignSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const member = await prisma.member.findFirst({ where: { id: req.body.memberId, ...tf }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'Member nahi mila' });
  const { journey, created } = await ensureJourneyForMember(prisma, tf.tenantId, member.id, req.body.templateId);
  if (!created || !journey) {
    return res.status(409).json({ error: 'Is member ki journey pehle se active hai ya koi default template nahi' });
  }
  audit(req, tf, 'onboarding.journey_started', journey.id, { memberId: member.id, templateName: journey.templateName });
  res.status(201).json({ journey, progress: progressOf(journey.stageTasks) });
});

router.get('/journeys/:id', requireRole(...STAFF, 'reception'), async (req, res) => {
  const tf = tenantFilter(req);
  const j = await prisma.memberJourney.findFirst({
    where: { id: req.params.id, ...tf },
    include: { member: { select: { id: true, name: true, email: true } }, template: { select: { id: true, name: true, stages: true } } },
  });
  if (!j) return res.status(404).json({ error: 'Journey nahi mili' });
  const stages = Array.isArray(j.template?.stages) ? j.template.stages : [];
  res.json({ journey: { ...j, stages, progress: progressOf(j.stageTasks) } });
});

const taskToggleSchema = z.object({ stageIndex: z.number().int().min(0), taskIndex: z.number().int().min(0), done: z.boolean() });

async function toggleTask(tenantId, journeyId, memberIdOrNull, stageIndex, taskIndex, done) {
  const j = await prisma.memberJourney.findFirst({ where: { id: journeyId, tenantId } });
  if (!j) return { status: 404, body: { error: 'Journey nahi mili' } };
  if (memberIdOrNull && j.memberId !== memberIdOrNull) {
    return { status: 403, body: { error: 'Yeh journey aapki nahi hai' } };
  }
  const arr = Array.isArray(j.stageTasks) ? JSON.parse(JSON.stringify(j.stageTasks)) : [];
  if (!arr[stageIndex] || arr[stageIndex][taskIndex] === undefined) {
    return { status: 422, body: { error: 'Task index ghalat hai' } };
  }
  arr[stageIndex][taskIndex] = done;
  const stage = resolveStage(arr);
  const allDone = stage >= arr.length;
  const updated = await prisma.memberJourney.update({
    where: { id: j.id },
    data: {
      stageTasks: arr, currentStage: allDone ? j.currentStage : stage,
      ...(allDone ? { status: 'completed', completedAt: new Date() } : {}),
    },
  });
  return { status: 200, body: { journey: { ...updated, progress: progressOf(updated.stageTasks) }, autoCompleted: allDone } };
}

router.post('/journeys/:id/tasks', requireRole(...STAFF, 'reception'), validateBody(taskToggleSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const { stageIndex, taskIndex, done } = req.body;
  const r = await toggleTask(tf.tenantId, req.params.id, null, stageIndex, taskIndex, done);
  if (r.status !== 200) return res.status(r.status).json(r.body);
  audit(req, tf, 'onboarding.task_toggled', req.params.id, { stageIndex, taskIndex, done, by: 'staff' });
  res.json(r.body);
});

router.patch('/journeys/:id', requireRole(...STAFF, 'reception'), validateBody(z.object({ status: z.enum(['active', 'completed', 'stalled']) })), async (req, res) => {
  const tf = tenantFilter(req);
  const j = await prisma.memberJourney.findFirst({ where: { id: req.params.id, ...tf }, select: { id: true } });
  if (!j) return res.status(404).json({ error: 'Journey nahi mili' });
  const updated = await prisma.memberJourney.update({
    where: { id: j.id },
    data: {
      status: req.body.status,
      completedAt: req.body.status === 'completed' ? new Date() : null,
    },
  });
  audit(req, tf, 'onboarding.journey_status', j.id, { status: req.body.status });
  res.json({ journey: { ...updated, progress: progressOf(updated.stageTasks) } });
});

// Members jinke paas koi journey nahi — default template se bulk start.
router.post('/journeys/auto-start', requireRole(...STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const def = await prisma.memberJourneyTemplate.findFirst({ where: { ...tf, isDefault: true } });
  if (!def) return res.status(422).json({ error: 'Pehle koi default template set karein' });
  const members = await prisma.member.findMany({ where: { ...tf }, select: { id: true } });
  const existing = await prisma.memberJourney.findMany({ where: { ...tf, status: 'active' }, select: { memberId: true } });
  const have = new Set(existing.map((e) => e.memberId));
  const stages = Array.isArray(def.stages) ? def.stages : [];
  const blank = blankStageTasks(stages);
  const missing = members.filter((m) => !have.has(m.id));
  let started = 0;
  for (const m of missing) {
    await prisma.memberJourney.create({
      data: { ...tf, memberId: m.id, templateId: def.id, templateName: def.name, stageTasks: blank, currentStage: 0, status: 'active' },
    });
    started++;
  }
  audit(req, tf, 'onboarding.auto_start', def.id, { started });
  res.json({ started, skipped: members.length - missing.length });
});

// ================= Member self =================
router.get('/my-journeys', async (req, res) => {
  const tf = tenantFilter(req);
  if (!req.user.memberId) return res.json({ journeys: [] });
  const journeys = await prisma.memberJourney.findMany({
    where: { ...tf, memberId: req.user.memberId }, orderBy: [{ startedAt: 'desc' }],
    include: { template: { select: { id: true, name: true, stages: true } } },
  });
  res.json({
    journeys: journeys.map((j) => ({
      ...j,
      stages: Array.isArray(j.template?.stages) ? j.template.stages : [],
      progress: progressOf(j.stageTasks),
    })),
  });
});

router.post('/journeys/:id/my-tasks', validateBody(taskToggleSchema), async (req, res) => {
  const tf = tenantFilter(req);
  if (!req.user.memberId) return res.status(403).json({ error: 'Member account required' });
  const { stageIndex, taskIndex, done } = req.body;
  const r = await toggleTask(tf.tenantId, req.params.id, req.user.memberId, stageIndex, taskIndex, done);
  res.status(r.status).json(r.body);
});

module.exports = { router, ensureJourneyForMember };
