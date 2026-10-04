// Phase 54 Track 7: Success task auto-generation.
// Coordinator: call ensureSuccessTasksScheduled() from server.js job wiring.
// At-risk member (health < 40) -> "check-in call" task.
// Stalled onboarding journey -> "journey follow-up" task.
// Models come from Phase 54 tracks 1/2/7 — merge hone se pehle defensive skip.
const prisma = require('./prisma');
const { writeAudit } = require('../middleware/audit');

const HEALTH_THRESHOLD = 40;
const STALLED_DAYS = 7;

function hasModel(name) {
  return !!(prisma && prisma[name]);
}

// Existing open task with same source+member dedupe.
async function hasOpenTask(tenantId, memberId, source) {
  if (!hasModel('successTask')) return true; // skip safely
  const t = await prisma.successTask.findFirst({
    where: { tenantId, memberId, source, status: { in: ['open', 'overdue'] } },
  });
  return !!t;
}

async function createTask(tenantId, data, auditMeta) {
  const task = await prisma.successTask.create({
    data: {
      tenantId,
      status: 'open',
      dueAt: new Date(Date.now() + 2 * 24 * 3600 * 1000), // 2 din
      ...data,
    },
  });
  try {
    await writeAudit(prisma, {
      tenantId,
      actorId: auditMeta?.actorId || null,
      action: 'success_task.auto_created',
      entity: 'SuccessTask',
      entityId: task.id,
      meta: { memberId: data.memberId, source: data.source },
    });
  } catch (_) {}
  return task;
}

// 1. At-risk members (MemberHealth.score < 40) -> check-in call task.
async function generateHealthTasks(tenantId) {
  if (!hasModel('successTask') || !hasModel('memberHealth')) return 0;
  const atRisk = await prisma.memberHealth.findMany({
    where: { tenantId, score: { lt: HEALTH_THRESHOLD } },
    include: { member: { select: { id: true, name: true, email: true } } },
  });
  let created = 0;
  for (const h of atRisk) {
    if (!h.member) continue;
    if (await hasOpenTask(tenantId, h.member.id, 'health-alert')) continue;
    await createTask(tenantId, {
      memberId: h.member.id,
      title: `Check-in call: ${h.member.name || h.member.email} (health ${h.score})`,
      notes: `Health score ${h.score}/100 — factors: ${JSON.stringify(h.factors || {})}`,
      source: 'health-alert',
    });
    created++;
  }
  return created;
}

// 2. Stalled onboarding journeys -> follow-up task.
async function generateJourneyTasks(tenantId) {
  if (!hasModel('successTask') || !hasModel('memberJourney')) return 0;
  const cutoff = new Date(Date.now() - STALLED_DAYS * 24 * 3600 * 1000);
  const stalled = await prisma.memberJourney.findMany({
    where: { tenantId, status: 'active', updatedAt: { lt: cutoff } },
    include: { member: { select: { id: true, name: true, email: true } } },
  });
  let created = 0;
  for (const j of stalled) {
    if (!j.member) continue;
    if (await hasOpenTask(tenantId, j.member.id, 'journey-stalled')) continue;
    await createTask(tenantId, {
      memberId: j.member.id,
      title: `Onboarding follow-up: ${j.member.name || j.member.email}`,
      notes: `Journey stage ${j.currentStage} par ${STALLED_DAYS}+ din se ruki hui hai.`,
      source: 'journey-stalled',
    });
    created++;
  }
  return created;
}

// Sab tenants ke liye chalao (daily job se).
async function generateSuccessTasks() {
  const results = { health: 0, journeys: 0, tenants: 0 };
  let tenants = [];
  try {
    tenants = await prisma.tenant.findMany({ where: { status: 'active' }, select: { id: true } });
  } catch (_) { return results; }
  for (const t of tenants) {
    try {
      results.health += await generateHealthTasks(t.id);
      results.journeys += await generateJourneyTasks(t.id);
      results.tenants++;
    } catch (_) {}
  }
  return results;
}

module.exports = { generateSuccessTasks, generateHealthTasks, generateJourneyTasks, HEALTH_THRESHOLD };
