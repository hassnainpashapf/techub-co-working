// Phase 31 Track 3: Dunning — overdue invoice reminder automation.
// Levels: 1 = polite (1-7 days overdue), 2 = firm (8-21), 3 = final notice (22+).
// Each level is sent at most once per invoice (DunningLog + unique constraint).
const prisma = require('./prisma');
const { notify, sendEmail } = require('./mailer');

const LEVEL_LABEL = { 1: 'Polite reminder', 2: 'Firm reminder', 3: 'Final notice' };

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.enqueue === 'function' && typeof j.registerHandler === 'function') return j;
  } catch {
    /* job queue not available */
  }
  return null;
}

function levelForDays(days) {
  if (days >= 22) return 3;
  if (days >= 8) return 2;
  return 1;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from, to) {
  return Math.floor((to.getTime() - new Date(from).getTime()) / 86400000);
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}

// Overdue invoices for a tenant, each annotated with daysOverdue + level.
async function findOverdue(tenantId) {
  const today = startOfToday();
  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      status: { in: ['unpaid', 'partial', 'overdue'] },
      dueDate: { lt: today },
    },
    include: {
      member: { select: { id: true, name: true, email: true, phone: true } },
      dunningLogs: { select: { level: true, sentAt: true } },
    },
    orderBy: { dueDate: 'asc' },
  });
  return invoices.map((inv) => {
    const daysOverdue = Math.max(daysBetween(inv.dueDate, today), 0);
    const sentLevels = (inv.dunningLogs || []).map((l) => l.level);
    return {
      id: inv.id,
      number: inv.number,
      memberId: inv.memberId,
      memberName: inv.member?.name || '',
      memberEmail: inv.member?.email || '',
      amount: Number(inv.amount),
      amountPaid: Number(inv.amountPaid || 0),
      balance: Number(inv.amount) - Number(inv.amountPaid || 0),
      dueDate: inv.dueDate,
      status: inv.status,
      daysOverdue,
      level: levelForDays(daysOverdue),
      levelLabel: LEVEL_LABEL[levelForDays(daysOverdue)],
      lastReminderLevel: sentLevels.length ? Math.max(...sentLevels) : null,
      sentLevels,
    };
  });
}

async function sendReminder(tenantId, inv) {
  const to = inv.memberEmail;
  if (!to) return { sent: false, reason: 'no-recipient-email' };
  const data = {
    memberName: inv.memberName,
    number: inv.number,
    amount: inv.balance,
    dueDate: fmtDate(inv.dueDate),
    daysOverdue: inv.daysOverdue,
    level: inv.level,
  };
  let result;
  try {
    result = await notify(tenantId, to, 'invoiceOverdue', data);
  } catch (err) {
    result = { sent: false, reason: String((err && err.message) || err) };
  }
  // Fallback: if the template is missing, send a generic email directly.
  if (result && result.reason === 'unknown-template') {
    try {
      result = await sendEmail(tenantId, {
        to,
        subject: `Payment reminder — invoice ${inv.number}`,
        html: `<p>Hi ${inv.memberName || 'there'},</p><p>Invoice <b>${inv.number}</b> for <b>Rs ${inv.balance.toLocaleString()}</b> is ${inv.daysOverdue} days overdue (due ${fmtDate(inv.dueDate)}). Please pay at your earliest convenience.</p>`,
      });
    } catch (err) {
      result = { sent: false, reason: String((err && err.message) || err) };
    }
  }
  return result || { sent: false, reason: 'unknown' };
}

// Process dunning for one tenant. Returns { processed, sent, skipped, results }.
async function processDunning(tenantId) {
  if (!tenantId) throw new Error('tenantId is required');
  const overdue = await findOverdue(tenantId);
  let sent = 0;
  let skipped = 0;
  const results = [];
  for (const inv of overdue) {
    if (inv.sentLevels.includes(inv.level)) {
      skipped++;
      results.push({ invoiceId: inv.id, number: inv.number, level: inv.level, sent: false, reason: 'already-sent' });
      continue;
    }
    const result = await sendReminder(tenantId, inv);
    const ok = !!(result && (result.sent || result.queued));
    if (ok) {
      sent++;
      try {
        await prisma.dunningLog.create({
          data: { tenantId, invoiceId: inv.id, level: inv.level, channel: 'email' },
        });
      } catch (err) {
        // P2002 = another run already logged this level — treat as sent, don't double count.
        if (!String((err && err.code) || '').includes('P2002')) throw err;
      }
    } else {
      skipped++;
    }
    results.push({
      invoiceId: inv.id,
      number: inv.number,
      memberName: inv.memberName,
      level: inv.level,
      sent: ok,
      reason: ok ? undefined : result.reason,
    });
  }
  return { processed: overdue.length, sent, skipped, results };
}

async function processAllTenants() {
  const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
  const out = [];
  for (const t of tenants) {
    try {
      const r = await processDunning(t.id);
      out.push({ tenantId: t.id, ...r, results: undefined });
    } catch (err) {
      out.push({ tenantId: t.id, error: String((err && err.message) || err) });
    }
  }
  return out;
}

// Register background handler (idempotent) — coordinator can enqueue {type:'dunning'} daily.
(function registerDunningHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__dunningRegistered) return;
  jobs.__dunningRegistered = true;
  jobs.registerHandler('dunning', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) {
      return processDunning(p.tenantId);
    }
    return processAllTenants();
  });
})();

module.exports = {
  processDunning,
  processAllTenants,
  findOverdue,
  levelForDays,
  LEVEL_LABEL,
};
