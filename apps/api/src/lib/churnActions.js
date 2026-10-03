// Phase 45 Track 7/10: Churn Auto-Actions — weekly automation for high-risk members.
// No migration: reuses phase 35 churn heuristic (routes/churn.js), phase 40 perks, tasks, audit.
//
// Coordinator wiring (server.js, additive):
//   require('./lib/churnActions');
//   require('./lib/churnActions').ensureChurnActionsScheduled();
//
// Har high-risk member (score >= 50) par weekly:
//   1. Personal retention email (phase 35 'retentionOffer' template, reasons ke sath)
//   2. Perk offer auto-create (phase 40: discount coupon member ko claim karaya jata hai)
//   3. Manager ko follow-up task assign (call reminder)
// Dedupe: ek member par 30 din me sirf ek dafa — audit_logs me action 'churn.auto_action'.
// Saray mutations audit me log hote hain.

const prisma = require('./prisma');
const { notify } = require('./mailer');
const { writeAudit } = require('../middleware/audit');

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

const DAY = 86400000;

// Phase 35 (routes/churn.js) wali heuristic — yahan duplicate hai taake job
// route se independent chale. Weights/labels wahi hain.
const W = {
  overdue_invoices: 30,
  no_recent_bookings: 20,
  no_recent_attendance: 15,
  contract_expiring: 20,
  nps_detractor: 15,
};
const AT_RISK_THRESHOLD = 25;
const HIGH_RISK = 50; // auto-actions sirf high-risk par (noise se bachao)

const REASON_LABELS = {
  overdue_invoices: 'Overdue invoices',
  no_recent_bookings: 'No bookings in 30 days',
  no_recent_attendance: 'No check-ins in 30 days',
  contract_expiring: 'Contract expiring soon',
  nps_detractor: 'NPS detractor',
};

function tenantWhere(tenantId) {
  return tenantId ? { tenantId } : {};
}

// Phase 35 jaisa scoring — at-risk members wapas karta hai (score >= threshold).
async function computeAtRisk(tenantId) {
  if (!prisma.member) return [];
  const tf = tenantWhere(tenantId);
  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * DAY);
  const contractCutoff = new Date(now.getTime() + 30 * DAY);

  const members = await prisma.member.findMany({
    where: { ...tf, status: { in: ['active', 'trial', 'on_hold'] } },
    select: {
      id: true,
      name: true,
      email: true,
      companyName: true,
      status: true,
      user: { select: { id: true } },
      invoices: {
        where: { status: { in: ['unpaid', 'partial', 'overdue'] }, dueDate: { lt: now } },
        select: { amount: true, amountPaid: true },
      },
      bookings: {
        where: { status: 'confirmed', startAt: { gte: cutoff30 } },
        select: { id: true },
        take: 1,
      },
      contracts: {
        where: { status: 'active', endDate: { lte: contractCutoff, gte: now } },
        select: { endDate: true },
        take: 1,
      },
      surveyResponses: {
        orderBy: { createdAt: 'desc' },
        select: { score: true },
        take: 1,
      },
    },
  }).catch(() => []);

  const userIds = members.map((m) => m.user && m.user.id).filter(Boolean);
  const recentAttendance = new Set();
  if (userIds.length && prisma.attendanceRecord) {
    const rows = await prisma.attendanceRecord.findMany({
      where: { ...tf, userId: { in: userIds }, date: { gte: cutoff30 } },
      select: { userId: true },
    }).catch(() => []);
    rows.forEach((r) => recentAttendance.add(r.userId));
  }

  const atRisk = [];
  for (const m of members) {
    const reasons = [];
    let score = 0;
    const overdueTotal = m.invoices.reduce(
      (s, inv) => s + (Number(inv.amount) - Number(inv.amountPaid)), 0
    );
    if (m.invoices.length > 0 && overdueTotal > 0) {
      score += W.overdue_invoices;
      reasons.push({ code: 'overdue_invoices', label: REASON_LABELS.overdue_invoices,
        detail: `${m.invoices.length} overdue · Rs ${Math.round(overdueTotal).toLocaleString()}` });
    }
    if (m.bookings.length === 0) {
      score += W.no_recent_bookings;
      reasons.push({ code: 'no_recent_bookings', label: REASON_LABELS.no_recent_bookings });
    }
    if (m.user && !recentAttendance.has(m.user.id)) {
      score += W.no_recent_attendance;
      reasons.push({ code: 'no_recent_attendance', label: REASON_LABELS.no_recent_attendance });
    }
    if (m.contracts.length > 0) {
      const days = Math.ceil((new Date(m.contracts[0].endDate) - now) / DAY);
      score += W.contract_expiring;
      reasons.push({ code: 'contract_expiring', label: REASON_LABELS.contract_expiring,
        detail: `ends in ${days} day${days === 1 ? '' : 's'}` });
    }
    const latest = m.surveyResponses[0];
    if (latest && latest.score != null && latest.score <= 6) {
      score += W.nps_detractor;
      reasons.push({ code: 'nps_detractor', label: REASON_LABELS.nps_detractor,
        detail: `score ${latest.score}/10` });
    }
    score = Math.min(score, 100);
    if (score >= AT_RISK_THRESHOLD) {
      atRisk.push({
        memberId: m.id, memberName: m.name, email: m.email,
        companyName: m.companyName, status: m.status, riskScore: score, reasons,
      });
    }
  }
  atRisk.sort((a, b) => b.riskScore - a.riskScore);
  return atRisk;
}

// Dedupe: member par last 30 din me auto-action hua? (audit_logs par)
async function recentlyActed(tenantId, memberId) {
  try {
    if (!prisma.auditLog) return false;
    const since = new Date(Date.now() - 30 * DAY);
    const hit = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'churn.auto_action', entity: 'member',
        entityId: memberId, createdAt: { gte: since } },
      select: { id: true },
    });
    return !!hit;
  } catch { return false; }
}

function audit(tenantId, memberId, payload) {
  writeAudit({
    tenantId,
    actorId: null, // system job
    action: 'churn.auto_action',
    entity: 'member',
    entityId: memberId,
    newValue: payload,
  }).catch(() => {});
}

// Action 2: perk offer — active perk dhoondo, na ho to retention perk banao,
// phir member ko claim karao (unique [perkId, memberId] respect).
async function grantRetentionPerk(tenantId, member) {
  if (!prisma.perk || !prisma.perkClaim) return null;
  const tf = tenantWhere(tenantId);
  let perk = await prisma.perk.findFirst({
    where: { ...tf, isActive: true, category: 'other' },
    orderBy: { createdAt: 'desc' },
  }).catch(() => null);
  if (!perk) {
    perk = await prisma.perk.create({
      data: {
        tenantId,
        partnerName: 'Techub',
        title: 'Loyalty Retention Reward',
        description: 'Auto-generated retention offer for valued members.',
        discountText: '10% off next invoice',
        category: 'other',
        isActive: true,
      },
    }).catch(() => null);
  }
  if (!perk) return null;
  const existing = await prisma.perkClaim.findUnique({
    where: { perkId_memberId: { perkId: perk.id, memberId: member.memberId } },
  }).catch(() => null);
  if (existing) return { perkId: perk.id, alreadyClaimed: true };
  await prisma.perkClaim.create({
    data: { tenantId, perkId: perk.id, memberId: member.memberId },
  }).catch(() => null);
  return { perkId: perk.id, perkTitle: perk.title };
}

// Action 3: manager ko follow-up task.
async function assignFollowupTask(tenantId, member) {
  if (!prisma.task) return null;
  const manager = await prisma.user.findFirst({
    where: { tenantId, role: { in: ['ceo', 'admin', 'manager'] },
      isActive: true, email: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  }).catch(() => null);
  if (!manager) return null;
  const reasonText = member.reasons
    .map((r) => `${r.label}${r.detail ? ` (${r.detail})` : ''}`).join('; ');
  const task = await prisma.task.create({
    data: {
      tenantId,
      title: `Retention follow-up call: ${member.memberName} (risk ${member.riskScore})`,
      description: `Churn auto-action: member ko call karke retention offer discuss karo.\nRisk score: ${member.riskScore}/100\nReasons: ${reasonText}`,
      assigneeId: manager.id,
      createdById: manager.id,
      priority: 'high',
      dueDate: new Date(Date.now() + 3 * DAY),
    },
  }).catch(() => null);
  return task ? { taskId: task.id, assignee: manager.name } : null;
}

async function runChurnActions() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } }).catch(() => []);
  let membersProcessed = 0;
  let membersSkipped = 0;
  const errors = [];

  for (const t of tenants) {
    let atRisk;
    try {
      atRisk = await computeAtRisk(t.id);
    } catch (e) {
      errors.push({ tenantId: t.id, reason: e.message });
      continue;
    }
    const highRisk = atRisk.filter((m) => m.riskScore >= HIGH_RISK);

    for (const m of highRisk) {
      if (await recentlyActed(t.id, m.memberId)) {
        membersSkipped += 1;
        continue;
      }
      const done = [];

      // 1. Retention email (personalized)
      if (m.email) {
        const reasonText = m.reasons.map((r) => r.label).join(', ');
        try {
          await notify(t.id, m.email, 'retentionOffer', {
            memberName: m.memberName,
            customMessage: `Hum ne dekha hai aap ki activity kam hui hai (${reasonText}). ` +
              `Aap hamare liye ahem hain — isi liye aap ke liye ek khaas loyalty offer bhi tayyar ki hai. ` +
              `Koi masla ho to jawab dein, hum foran madad karenge.`,
          });
          done.push('retention_email');
        } catch (e) { errors.push({ memberId: m.memberId, action: 'email', reason: e.message }); }
      }

      // 2. Perk offer
      try {
        const perk = await grantRetentionPerk(t.id, m);
        if (perk) done.push(perk.alreadyClaimed ? 'perk_already_claimed' : 'perk_granted');
      } catch (e) { errors.push({ memberId: m.memberId, action: 'perk', reason: e.message }); }

      // 3. Manager follow-up task
      try {
        const task = await assignFollowupTask(t.id, m);
        if (task) done.push('followup_task');
      } catch (e) { errors.push({ memberId: m.memberId, action: 'task', reason: e.message }); }

      audit(t.id, m.memberId, { riskScore: m.riskScore, reasons: m.reasons.map((r) => r.code), actions: done });
      membersProcessed += 1;
    }
  }

  return { ok: true, membersProcessed, membersSkipped, errors: errors.slice(0, 20) };
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('churn-auto-actions', async () => runChurnActions());
    }
  } catch { /* job queue optional */ }
})();

// Weekly: next Monday 07:00 (Asia/Karachi-friendly morning).
async function ensureChurnActionsScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs || !prisma.job) return;
    const pending = await prisma.job.count({
      where: { type: 'churn-auto-actions', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const next = new Date();
      next.setHours(7, 0, 0, 0);
      // aglay Monday tak
      const add = (8 - next.getDay()) % 7 || 7;
      next.setDate(next.getDate() + add);
      await jobs.enqueue('churn-auto-actions', {}, { runAt: next });
    }
  } catch (e) {
    console.error('[churn-actions] ensure schedule failed:', e.message);
  }
}

module.exports = { runChurnActions, computeAtRisk, ensureChurnActionsScheduled };
