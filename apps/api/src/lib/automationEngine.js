// Phase 38 Track 6: Task Automation Rules — rule engine.
// evaluateAutomation(tenantId, trigger, context) is called fire-and-forget
// from route handlers / jobs. It loads active rules for the trigger,
// checks conditions, executes actions, and dedupes per entity.
const prisma = require('./prisma');
const { decryptSecret } = require('./crypto');

// Graceful 503 when fragment not yet merged (schema missing).
async function rulesAvailable() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return typeof prisma.automationRule !== 'undefined';
  } catch {
    return false;
  }
}

const TRIGGERS = [
  'invoice_overdue',
  'ticket_urgent_created',
  'booking_cancelled',
  'contract_expiring',
  'member_inactive',
];

function fillVars(text, ctx) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : ''));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// All conditions must match. Unknown condition keys are ignored.
function conditionsMatch(trigger, conditions, ctx) {
  const c = conditions || {};
  switch (trigger) {
    case 'invoice_overdue': {
      const days = num(ctx.daysOverdue);
      if (c.minDaysOverdue != null && (days == null || days < Number(c.minDaysOverdue))) return false;
      if (c.maxDaysOverdue != null && (days == null || days > Number(c.maxDaysOverdue))) return false;
      const amt = num(ctx.balance ?? ctx.amount);
      if (c.minAmount != null && (amt == null || amt < Number(c.minAmount))) return false;
      return true;
    }
    case 'ticket_urgent_created': {
      if (Array.isArray(c.categories) && c.categories.length && !c.categories.includes(ctx.category)) return false;
      return true;
    }
    case 'booking_cancelled': {
      if (c.unitType && ctx.unitType && ctx.unitType !== c.unitType) return false;
      const h = num(ctx.hoursBeforeStart);
      if (c.minHoursBeforeStart != null && (h == null || h < Number(c.minHoursBeforeStart))) return false;
      return true;
    }
    case 'contract_expiring': {
      const d = num(ctx.daysLeft);
      if (Array.isArray(c.daysLeft) && c.daysLeft.length && !c.daysLeft.includes(d)) return false;
      if (c.minDaysLeft != null && (d == null || d < Number(c.minDaysLeft))) return false;
      if (c.maxDaysLeft != null && (d == null || d > Number(c.maxDaysLeft))) return false;
      return true;
    }
    case 'member_inactive': {
      const d = num(ctx.daysInactive);
      if (c.minDaysInactive != null && (d == null || d < Number(c.minDaysInactive))) return false;
      return true;
    }
    default:
      return false;
  }
}

async function dedupeKey(ruleId, trigger, entityId) {
  if (!entityId) return false; // no entity → allow every time
  const recent = await prisma.automationRun.findFirst({
    where: {
      ruleId,
      trigger,
      entityId,
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });
  return !!recent;
}

// ---- action executors ----

async function actionCreateTask(tenantId, action, ctx) {
  const title = fillVars(action.title || 'Automated task', ctx);
  const data = {
    tenantId,
    title: title.slice(0, 200),
    description: fillVars(action.description || '', ctx) || null,
    priority: ['low', 'medium', 'high', 'urgent'].includes(action.priority) ? action.priority : 'medium',
    status: 'pending',
  };
  // createdById: use a tenant staff member; fall back to first ceo/admin user
  let creator = null;
  if (action.createdById) {
    creator = await prisma.user.findFirst({ where: { id: action.createdById, tenantId } });
  }
  if (!creator) {
    creator = await prisma.user.findFirst({
      where: { tenantId, role: { in: ['ceo', 'admin', 'super_admin'] } },
      orderBy: { createdAt: 'asc' },
    });
  }
  if (!creator) return { ok: false, skipped: 'no staff user to own task' };
  data.createdById = creator.id;
  if (action.assigneeId) {
    const assignee = await prisma.user.findFirst({ where: { id: action.assigneeId, tenantId } });
    if (assignee) data.assigneeId = assignee.id;
  }
  if (action.dueInDays != null) {
    const d = new Date();
    d.setDate(d.getDate() + Number(action.dueInDays));
    data.dueDate = d;
  }
  const task = await prisma.task.create({ data });
  return { ok: true, taskId: task.id };
}

async function actionSendEmail(tenantId, action, ctx) {
  const { sendEmail } = require('./mailer');
  let to = action.to;
  if (to === 'member') to = ctx.memberEmail;
  if (to === 'staff') {
    const staff = await prisma.user.findMany({
      where: { tenantId, role: { in: ['ceo', 'admin', 'manager'] } },
      select: { email: true },
      take: 10,
    });
    to = staff.map((u) => u.email).filter(Boolean);
  }
  if (!to || (Array.isArray(to) && !to.length)) return { ok: false, skipped: 'no recipient' };
  await sendEmail(tenantId, {
    to,
    subject: fillVars(action.subject || 'Notification', ctx),
    html: fillVars(action.body || '', ctx),
  });
  return { ok: true };
}

async function actionNotifySlack(tenantId, action, ctx) {
  const { getIntegration, sendSlackMessage } = require('./slack');
  const row = await getIntegration(tenantId);
  if (!row || !row.isActive) return { ok: false, skipped: 'slack not configured' };
  const url = decryptSecret(row.webhookUrl);
  await sendSlackMessage(url, { text: `🤖 ${fillVars(action.text || 'Automation rule fired', ctx)}` });
  return { ok: true };
}

async function actionAssignTicket(tenantId, action, ctx) {
  const ticketId = ctx.ticketId;
  if (!ticketId) return { ok: false, skipped: 'no ticket in context' };
  if (!action.assigneeId) return { ok: false, skipped: 'no assignee' };
  const assignee = await prisma.user.findFirst({ where: { id: action.assigneeId, tenantId } });
  if (!assignee) return { ok: false, skipped: 'assignee not found' };
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { assigneeId: assignee.id },
  });
  return { ok: true, assigneeId: assignee.id };
}

const ACTION_HANDLERS = {
  create_task: actionCreateTask,
  send_email: actionSendEmail,
  notify_slack: actionNotifySlack,
  assign_ticket: actionAssignTicket,
};

// Dry-run preview without executing.
function previewActions(rule, ctx) {
  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  return actions.map((a) => ({
    type: a.type,
    summary:
      a.type === 'create_task'
        ? `Create task: "${fillVars(a.title || '', ctx)}"`
        : a.type === 'send_email'
          ? `Send email to ${a.to === 'member' ? ctx.memberEmail || 'member' : a.to || 'staff'}: "${fillVars(a.subject || '', ctx)}"`
          : a.type === 'notify_slack'
            ? `Post to Slack: "${fillVars(a.text || '', ctx)}"`
            : a.type === 'assign_ticket'
              ? `Assign ticket ${ctx.ticketId || ''} to user`
              : `Unknown action: ${a.type}`,
    supported: !!ACTION_HANDLERS[a.type],
  }));
}

async function executeRule(tenantId, rule, ctx, { dryRun = false } = {}) {
  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  const results = [];
  for (const action of actions) {
    const handler = ACTION_HANDLERS[action.type];
    if (!handler) {
      results.push({ type: action.type, ok: false, skipped: 'unknown action type' });
      continue;
    }
    if (dryRun) {
      results.push({ type: action.type, ok: true, dryRun: true });
      continue;
    }
    try {
      results.push({ type: action.type, ...(await handler(tenantId, action, ctx)) });
    } catch (e) {
      results.push({ type: action.type, ok: false, error: e.message || 'action failed' });
    }
  }
  return results;
}

async function evaluateAutomation(tenantId, trigger, context = {}, opts = {}) {
  if (!tenantId || !TRIGGERS.includes(trigger)) return { rules: 0, fired: 0, results: [] };
  try {
    if (!(await rulesAvailable())) return { rules: 0, fired: 0, skipped: 'schema not merged' };
    const rules = await prisma.automationRule.findMany({
      where: { tenantId, trigger, isActive: true },
    });
    const results = [];
    let fired = 0;
    for (const rule of rules) {
      if (!conditionsMatch(trigger, rule.conditions, context)) continue;
      const entityId = context.entityId || null;
      if (!opts.dryRun && (await dedupeKey(rule.id, trigger, entityId))) {
        results.push({ ruleId: rule.id, name: rule.name, skipped: 'already fired in last 30 days' });
        continue;
      }
      const actionResults = await executeRule(tenantId, rule, context, opts);
      fired += 1;
      if (!opts.dryRun) {
        await prisma.automationRun.create({
          data: { tenantId, ruleId: rule.id, trigger, entityId },
        }).catch(() => {});
      }
      results.push({ ruleId: rule.id, name: rule.name, actions: actionResults });
    }
    return { rules: rules.length, fired, results };
  } catch (e) {
    // Never break the calling flow.
    return { rules: 0, fired: 0, error: e.message };
  }
}

// ---- batch trigger: member_inactive (daily scan, registered as job handler) ----

async function findInactiveMembers(tenantId, minDays) {
  const cutoff = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000);
  const members = await prisma.member.findMany({
    where: { tenantId, status: 'active' },
    select: { id: true, name: true, email: true, phone: true, companyName: true },
    take: 500,
  });
  const inactive = [];
  for (const m of members) {
    const lastActivity = await prisma.attendance.findFirst({
      where: { tenantId, memberId: m.id },
      orderBy: { date: 'desc' },
      select: { date: true },
    }).catch(() => null);
    const lastBooking = await prisma.booking.findFirst({
      where: { tenantId, memberId: m.id, status: { not: 'cancelled' } },
      orderBy: { startAt: 'desc' },
      select: { startAt: true },
    }).catch(() => null);
    const lastPay = await prisma.payment.findFirst({
      where: { tenantId, memberId: m.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }).catch(() => null);
    const dates = [lastActivity?.date, lastBooking?.startAt, lastPay?.createdAt].filter(Boolean);
    const latest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    const daysInactive = latest ? Math.floor((Date.now() - latest.getTime()) / 86400000) : 999;
    if (daysInactive >= minDays) {
      inactive.push({ ...m, daysInactive, entityId: m.id });
    }
  }
  return inactive;
}

async function scanInactiveMembers() {
  if (!(await rulesAvailable())) return;
  const rules = await prisma.automationRule.findMany({
    where: { trigger: 'member_inactive', isActive: true },
  });
  const byTenant = {};
  for (const r of rules) {
    (byTenant[r.tenantId] = byTenant[r.tenantId] || []).push(r);
  }
  for (const [tenantId, tenantRules] of Object.entries(byTenant)) {
    const minDays = Math.min(
      ...tenantRules.map((r) => Number(r.conditions?.minDaysInactive) || 14)
    );
    const inactive = await findInactiveMembers(tenantId, minDays).catch(() => []);
    for (const m of inactive) {
      await evaluateAutomation(tenantId, 'member_inactive', {
        memberId: m.id,
        memberName: m.name,
        memberEmail: m.email,
        memberPhone: m.phone,
        companyName: m.companyName,
        daysInactive: m.daysInactive,
        entityId: m.id,
      }).catch(() => {});
    }
  }
}

// Register as daily background job handler when the queue exists.
(function registerInactiveScan() {
  try {
    const jobs = require('./jobs');
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('automation-inactive-scan', async () => {
        await scanInactiveMembers();
        return { ok: true };
      });
    }
  } catch { /* queue not loaded yet */ }
})();

module.exports = {
  TRIGGERS,
  evaluateAutomation,
  conditionsMatch,
  previewActions,
  findInactiveMembers,
  scanInactiveMembers,
};
