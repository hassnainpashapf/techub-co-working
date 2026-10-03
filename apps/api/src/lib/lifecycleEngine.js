// Phase 38 Track 2: Member Lifecycle Automation engine.
// Daily job: evaluates active LifecycleRules per tenant and sends email/SMS
// to matching members. Dedupe: at most one send per rule+member per 30 days.
//
// Triggers:
//   trial_ending_3d      — members with status 'trial' whose trial ends within 3 days
//                          (trial length = 14 days from member.createdAt, per onboarding)
//   contract_expiring_30d — members with an active contract ending within 30 days
//   member_inactive_14d  — active members with no booking/check-in in 14 days
//   invoice_overdue_7d   — members with an invoice overdue by >= 7 days
const prisma = require('./prisma');
const { notify } = require('./mailer');
const { sendSms } = require('./sms');

const DEDUPE_DAYS = 30;
const TRIAL_DAYS = 14; // onboarding creates a 14-day trial

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.enqueue === 'function' && typeof j.registerHandler === 'function') return j;
  } catch {
    /* job queue not available */
  }
  return null;
}

function schemaReady() {
  return Boolean(prisma.lifecycleRule && prisma.lifecycleRun);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(from, to) {
  return Math.floor((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString()}`;
}

// Fill {{variables}} in a custom message body.
function fillVars(template, data) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) =>
    data && data[k] !== undefined && data[k] !== null ? String(data[k]) : m
  );
}

// ---------------------------------------------------------------------------
// Audience evaluation — each returns [{ member: {id,name,email,phone}, data }]
// ---------------------------------------------------------------------------

async function audienceTrialEnding(tenantId) {
  const now = new Date();
  const members = await prisma.member.findMany({
    where: { tenantId, status: 'trial' },
    select: { id: true, name: true, email: true, phone: true, createdAt: true },
  });
  const out = [];
  for (const m of members) {
    const trialEnd = new Date(new Date(m.createdAt).getTime() + TRIAL_DAYS * 86400000);
    const daysLeft = daysBetween(now, trialEnd);
    if (daysLeft >= 0 && daysLeft <= 3) {
      out.push({
        member: m,
        data: { memberName: m.name, trialEndsAt: fmtDate(trialEnd), daysLeft },
      });
    }
  }
  return out;
}

async function audienceContractExpiring(tenantId) {
  const today = startOfDay(new Date());
  const horizon = new Date(today.getTime() + 30 * 86400000);
  const contracts = await prisma.contract.findMany({
    where: {
      tenantId,
      status: 'active',
      endDate: { gte: today, lte: horizon },
    },
    include: {
      member: { select: { id: true, name: true, email: true, phone: true, status: true } },
      unit: { select: { code: true } },
    },
    orderBy: { endDate: 'asc' },
  });
  // One reminder per member per 30 days — keep the nearest-expiring contract.
  const seen = new Set();
  const out = [];
  for (const c of contracts) {
    if (!c.member || c.member.status === 'exited' || seen.has(c.member.id)) continue;
    seen.add(c.member.id);
    out.push({
      member: c.member,
      data: {
        memberName: c.member.name,
        unitCode: c.unit?.code || '',
        endDate: fmtDate(c.endDate),
        rentAmount: Number(c.rentAmount || 0),
        rentAmountFmt: fmtMoney(c.rentAmount),
        daysLeft: daysBetween(today, c.endDate),
      },
    });
  }
  return out;
}

async function audienceInactive(tenantId) {
  const cutoff = new Date(Date.now() - 14 * 86400000);
  const [recentBookings, recentAttendance] = await Promise.all([
    prisma.booking.findMany({
      where: { tenantId, startAt: { gte: cutoff } },
      select: { memberId: true },
      distinct: ['memberId'],
    }),
    prisma.attendanceRecord.findMany({
      where: { tenantId, checkIn: { gte: cutoff } },
      select: { user: { select: { memberId: true } } },
    }),
  ]);
  const activeIds = new Set([
    ...recentBookings.map((b) => b.memberId).filter(Boolean),
    ...recentAttendance.map((a) => a.user?.memberId).filter(Boolean),
  ]);
  const members = await prisma.member.findMany({
    where: { tenantId, status: 'active' },
    select: { id: true, name: true, email: true, phone: true },
  });
  return members
    .filter((m) => !activeIds.has(m.id))
    .map((m) => ({ member: m, data: { memberName: m.name } }));
}

async function audienceInvoiceOverdue(tenantId) {
  const sevenDaysAgo = startOfDay(new Date(Date.now() - 7 * 86400000));
  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      status: { in: ['unpaid', 'partial', 'overdue'] },
      dueDate: { lte: sevenDaysAgo },
    },
    include: { member: { select: { id: true, name: true, email: true, phone: true, status: true } } },
    orderBy: { dueDate: 'asc' },
  });
  const today = startOfDay(new Date());
  const seen = new Set();
  const out = [];
  for (const inv of invoices) {
    if (!inv.member || inv.member.status === 'exited' || seen.has(inv.member.id)) continue;
    seen.add(inv.member.id);
    const balance = Number(inv.amount) - Number(inv.amountPaid || 0);
    if (balance <= 0) continue;
    out.push({
      member: inv.member,
      data: {
        memberName: inv.member.name,
        number: inv.number,
        amount: balance,
        amountFmt: fmtMoney(balance),
        dueDate: fmtDate(inv.dueDate),
        daysOverdue: daysBetween(inv.dueDate, today),
        level: 1,
      },
    });
  }
  return out;
}

const TRIGGERS = {
  trial_ending_3d: {
    key: 'trial_ending_3d',
    label: 'Trial ending (3 days)',
    description: 'Members whose 14-day trial ends within the next 3 days.',
    defaultTemplate: 'trialEnding',
    defaultSms: 'Hi {{memberName}}, your trial ends on {{trialEndsAt}}. Upgrade to a full membership to keep your space — just reply to this message!',
  },
  contract_expiring_30d: {
    key: 'contract_expiring_30d',
    label: 'Contract expiring (30 days)',
    description: 'Members with an active contract ending within 30 days.',
    defaultTemplate: 'contractExpiring',
    defaultSms: 'Hi {{memberName}}, your contract{{unitCode}} expires on {{endDate}}. Reply to renew and avoid interruption.',
  },
  member_inactive_14d: {
    key: 'member_inactive_14d',
    label: 'Inactive member (14 days)',
    description: 'Active members with no booking or check-in in the last 14 days.',
    defaultTemplate: 'retentionOffer',
    defaultSms: 'Hi {{memberName}}, we miss you at the workspace! Come by this week — your space is waiting.',
  },
  invoice_overdue_7d: {
    key: 'invoice_overdue_7d',
    label: 'Invoice overdue (7+ days)',
    description: 'Members with an invoice overdue by 7 days or more.',
    defaultTemplate: 'invoiceOverdue',
    defaultSms: 'Hi {{memberName}}, invoice {{number}} ({{amountFmt}}) is {{daysOverdue}} days overdue. Please pay at your earliest convenience.',
  },
};

const TRIGGER_KEYS = Object.keys(TRIGGERS);

function evaluateTrigger(trigger, tenantId) {
  switch (trigger) {
    case 'trial_ending_3d': return audienceTrialEnding(tenantId);
    case 'contract_expiring_30d': return audienceContractExpiring(tenantId);
    case 'member_inactive_14d': return audienceInactive(tenantId);
    case 'invoice_overdue_7d': return audienceInvoiceOverdue(tenantId);
    default: throw new Error(`Unknown trigger: ${trigger}`);
  }
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

async function wasRecentlySent(ruleId, memberId) {
  const cutoff = new Date(Date.now() - DEDUPE_DAYS * 86400000);
  const run = await prisma.lifecycleRun.findFirst({
    where: { ruleId, memberId, sent: true, sentAt: { gte: cutoff } },
    select: { id: true },
  });
  return Boolean(run);
}

async function sendToMember(tenantId, rule, member, data) {
  const channel = rule.action === 'sms' ? 'sms' : 'email';
  if (channel === 'sms') {
    const to = member.phone;
    if (!to) return { sent: false, reason: 'no-phone' };
    const body = fillVars(rule.message || TRIGGERS[rule.trigger].defaultSms, data);
    try {
      const r = await sendSms(tenantId, to, body);
      return r && r.sent ? { sent: true, provider: r.provider } : { sent: false, reason: r.error || 'sms-failed' };
    } catch (err) {
      return { sent: false, reason: String((err && err.message) || err) };
    }
  }
  const to = member.email;
  if (!to) return { sent: false, reason: 'no-email' };
  const templateKey = rule.templateKey || TRIGGERS[rule.trigger].defaultTemplate;
  const payload = { ...data };
  if (rule.message && templateKey === 'retentionOffer') payload.customMessage = rule.message;
  try {
    const r = await notify(tenantId, to, templateKey, payload);
    if (r && (r.sent || r.queued)) return { sent: true };
    // Fallback: unknown template → generic email so the rule still works.
    if (r && r.reason === 'unknown-template') {
      const fb = await notify(tenantId, to, TRIGGERS[rule.trigger].defaultTemplate, payload);
      return fb && (fb.sent || fb.queued) ? { sent: true } : { sent: false, reason: 'unknown-template' };
    }
    return { sent: false, reason: (r && r.reason) || 'email-failed' };
  } catch (err) {
    return { sent: false, reason: String((err && err.message) || err) };
  }
}

// Process one rule for one tenant. Returns { evaluated, sent, skipped, results }.
async function processRule(tenantId, rule) {
  if (!schemaReady()) throw new Error('lifecycle-schema-not-ready');
  if (!TRIGGERS[rule.trigger]) throw new Error(`Unknown trigger: ${rule.trigger}`);
  const audience = await evaluateTrigger(rule.trigger, tenantId);
  let sent = 0;
  let skipped = 0;
  const results = [];
  for (const { member, data } of audience) {
    if (await wasRecentlySent(rule.id, member.id)) {
      skipped++;
      results.push({ memberId: member.id, memberName: member.name, sent: false, reason: 'already-sent-30d' });
      continue;
    }
    const r = await sendToMember(tenantId, rule, member, data);
    try {
      await prisma.lifecycleRun.create({
        data: {
          tenantId,
          ruleId: rule.id,
          memberId: member.id,
          channel: rule.action === 'sms' ? 'sms' : 'email',
          sent: r.sent,
          error: r.sent ? null : r.reason || null,
        },
      });
    } catch (e) {
      console.error('[lifecycle] run log failed:', e.message);
    }
    if (r.sent) sent++;
    else skipped++;
    results.push({ memberId: member.id, memberName: member.name, sent: r.sent, reason: r.sent ? undefined : r.reason });
  }
  await prisma.lifecycleRule.update({
    where: { id: rule.id },
    data: { lastRunAt: new Date() },
  }).catch(() => {});
  return { evaluated: audience.length, sent, skipped, results };
}

// Process all active rules for one tenant.
async function processTenant(tenantId) {
  if (!schemaReady()) throw new Error('lifecycle-schema-not-ready');
  const rules = await prisma.lifecycleRule.findMany({ where: { tenantId, isActive: true } });
  const out = [];
  for (const rule of rules) {
    try {
      const r = await processRule(tenantId, rule);
      out.push({ ruleId: rule.id, trigger: rule.trigger, action: rule.action, ...r, results: undefined });
    } catch (err) {
      out.push({ ruleId: rule.id, trigger: rule.trigger, error: String((err && err.message) || err) });
    }
  }
  return out;
}

async function processAllTenants() {
  if (!schemaReady()) throw new Error('lifecycle-schema-not-ready');
  const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
  const out = [];
  for (const t of tenants) {
    try {
      const r = await processTenant(t.id);
      out.push({ tenantId: t.id, rules: r });
    } catch (err) {
      out.push({ tenantId: t.id, error: String((err && err.message) || err) });
    }
  }
  return out;
}

// Create the 4 default rules (email action) for tenants missing them.
async function seedDefaults(tenantId) {
  if (!schemaReady()) throw new Error('lifecycle-schema-not-ready');
  const created = [];
  for (const key of TRIGGER_KEYS) {
    const existing = await prisma.lifecycleRule.findUnique({
      where: { tenantId_trigger: { tenantId, trigger: key } },
    });
    if (existing) continue;
    const rule = await prisma.lifecycleRule.create({
      data: { tenantId, trigger: key, action: 'email', isActive: true },
    });
    created.push(rule);
  }
  return created;
}

// Audience counts for all triggers (for the settings UI).
async function audienceCounts(tenantId) {
  if (!schemaReady()) throw new Error('lifecycle-schema-not-ready');
  const counts = {};
  for (const key of TRIGGER_KEYS) {
    try {
      counts[key] = (await evaluateTrigger(key, tenantId)).length;
    } catch {
      counts[key] = 0;
    }
  }
  return counts;
}

// Register background handler (idempotent) — enqueue {type:'lifecycle-run'} daily.
(function registerLifecycleHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__lifecycleRegistered) return;
  jobs.__lifecycleRegistered = true;
  jobs.registerHandler('lifecycle-run', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (!schemaReady()) return { skipped: true, reason: 'lifecycle-schema-not-ready' };
    if (p.tenantId) return processTenant(p.tenantId);
    return processAllTenants();
  });
})();

module.exports = {
  TRIGGERS,
  TRIGGER_KEYS,
  evaluateTrigger,
  audienceCounts,
  processRule,
  processTenant,
  processAllTenants,
  seedDefaults,
  schemaReady,
  DEDUPE_DAYS,
};
