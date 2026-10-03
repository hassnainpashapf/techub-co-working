// Phase 38 Track 10: Smart Reminders Engine.
// Unified reminder engine: ReminderRule (entity + timing + daysOffset + channels)
// -> finds due entities -> sends via email/sms/push -> logs once per rule+entity.
//
// Existing scattered reminder jobs (dunning, contract expiry, etc.) are NOT
// touched — this engine is additive. Old flows keep working; new rules live here.
//
// Wiring (coordinator): require('./lib/reminders') (handler auto-registers) and
// daily enqueue: enqueue('reminders', { tenantId }) or without tenantId for all.
const prisma = require('./prisma');
const { notify } = require('./mailer');
const { sendSms } = require('./sms');
const { sendPushToUser } = require('./push');

const ENTITIES = ['invoice', 'contract', 'booking', 'maintenance', 'document'];
const CHANNELS = ['email', 'sms', 'push'];

const ENTITY_LABELS = {
  invoice: 'Invoice',
  contract: 'Contract',
  booking: 'Booking',
  maintenance: 'Maintenance request',
  document: 'Document',
};

const DEFAULT_TEMPLATES = {
  invoice: 'invoiceReminder',
  contract: 'contractReminder',
  booking: 'bookingReminder',
  maintenance: 'maintenanceReminder',
  document: 'documentReminder',
};

function modelsReady() {
  return !!(prisma.reminderRule && prisma.reminderLog);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

function fmtMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString()}`;
}

// ---------- recipient resolution ----------
async function memberUserId(tenantId, memberId) {
  if (!memberId) return null;
  try {
    const u = await prisma.user.findFirst({
      where: { tenantId, memberId },
      select: { id: true },
    });
    return u ? u.id : null;
  } catch {
    return null;
  }
}

function memberContact(member) {
  if (!member) return null;
  return {
    name: member.name || 'there',
    email: member.email || null,
    phone: member.phone || null,
    memberId: member.id,
  };
}

// ---------- entity finders ----------
// Each returns [{ entityId, label, contact, userId?, vars, smsText, pushTitle, pushBody }]
async function findInvoices(tenantId, rule) {
  const today = startOfToday();
  const where = { tenantId, status: { in: ['unpaid', 'partial', 'overdue'] } };
  if (rule.timing === 'before') {
    where.status = { in: ['unpaid', 'partial'] };
    where.dueDate = { gte: today, lte: addDays(today, rule.daysOffset) };
  } else {
    where.dueDate = { lte: addDays(today, -rule.daysOffset) };
  }
  const rows = await prisma.invoice.findMany({
    where,
    include: { member: { select: { id: true, name: true, email: true, phone: true } } },
    take: 2000,
  });
  return rows.map((inv) => {
    const contact = memberContact(inv.member);
    const vars = {
      memberName: contact ? contact.name : 'there',
      invoiceNumber: inv.number,
      amount: fmtMoney(inv.amount),
      dueDate: fmtDate(inv.dueDate),
    };
    return {
      entityId: inv.id,
      label: `${inv.number} — ${fmtMoney(inv.amount)}`,
      contact,
      vars,
      smsText: `Reminder: invoice ${inv.number} of ${fmtMoney(inv.amount)} is due ${fmtDate(inv.dueDate)}. Please pay at your earliest.`,
      pushTitle: 'Invoice reminder',
      pushBody: `Invoice ${inv.number} (${fmtMoney(inv.amount)}) due ${fmtDate(inv.dueDate)}.`,
    };
  });
}

async function findContracts(tenantId, rule) {
  const today = startOfToday();
  const where = { tenantId, status: 'active', endDate: { not: null } };
  if (rule.timing === 'before') {
    where.endDate = { gte: today, lte: addDays(today, rule.daysOffset) };
  } else {
    where.endDate = { lte: addDays(today, -rule.daysOffset) };
  }
  const rows = await prisma.contract.findMany({
    where,
    include: {
      member: { select: { id: true, name: true, email: true, phone: true } },
      unit: { select: { code: true } },
    },
    take: 2000,
  });
  return rows.map((c) => {
    const contact = memberContact(c.member);
    const vars = {
      memberName: contact ? contact.name : 'there',
      unitCode: c.unit ? c.unit.code : '',
      endDate: fmtDate(c.endDate),
    };
    return {
      entityId: c.id,
      label: `${c.unit ? c.unit.code : 'Contract'} — ends ${fmtDate(c.endDate)}`,
      contact,
      vars,
      smsText: `Reminder: your contract${c.unit ? ` (${c.unit.code})` : ''} expires on ${fmtDate(c.endDate)}. Please contact us to renew.`,
      pushTitle: 'Contract reminder',
      pushBody: `Your contract${c.unit ? ` (${c.unit.code})` : ''} expires on ${fmtDate(c.endDate)}.`,
    };
  });
}

async function findBookings(tenantId, rule) {
  // Bookings only make sense "before" — a reminder ahead of the booking.
  const now = new Date();
  const cutoff = addDays(startOfToday(), rule.daysOffset + 1);
  const rows = await prisma.booking.findMany({
    where: {
      tenantId,
      status: 'confirmed',
      startAt: { gte: now, lt: cutoff },
    },
    include: {
      member: { select: { id: true, name: true, email: true, phone: true } },
      unit: { select: { code: true } },
    },
    take: 2000,
  });
  return rows
    .filter((b) => b.memberId)
    .map((b) => {
      const contact = memberContact(b.member);
      const when = new Date(b.startAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const vars = {
        memberName: contact ? contact.name : 'there',
        title: b.title,
        unitCode: b.unit ? b.unit.code : '',
        startAt: when,
      };
      return {
        entityId: b.id,
        label: `${b.title} — ${when}`,
        contact,
        vars,
        smsText: `Reminder: your booking "${b.title}"${b.unit ? ` at ${b.unit.code}` : ''} starts ${when}.`,
        pushTitle: 'Booking reminder',
        pushBody: `"${b.title}" starts ${when}.`,
      };
    });
}

async function findMaintenance(tenantId, rule) {
  // "after": still open X days after being reported.
  const today = startOfToday();
  const rows = await prisma.maintenanceRequest.findMany({
    where: {
      tenantId,
      status: { notIn: ['resolved', 'closed', 'cancelled'] },
      createdAt: { lte: addDays(today, -rule.daysOffset) },
    },
    include: {
      member: { select: { id: true, name: true, email: true, phone: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
    take: 2000,
  });
  return rows.map((r) => {
    const daysOpen = Math.max(0, Math.floor((today.getTime() - new Date(r.createdAt).getTime()) / 86400000));
    // Primary recipient: assigned staff; fallback: requesting member.
    let contact = null;
    let userId = null;
    if (r.assignedTo) {
      contact = { name: r.assignedTo.name || 'there', email: r.assignedTo.email || null, phone: null, memberId: null };
      userId = r.assignedTo.id;
    } else if (r.member) {
      contact = memberContact(r.member);
    }
    const vars = {
      name: contact ? contact.name : 'there',
      title: r.title,
      location: r.location || '',
      daysOpen: String(daysOpen),
    };
    return {
      entityId: r.id,
      label: `${r.title} — open ${daysOpen} days`,
      contact,
      userId,
      vars,
      smsText: `Reminder: maintenance request "${r.title}" is still open after ${daysOpen} days.`,
      pushTitle: 'Maintenance reminder',
      pushBody: `"${r.title}" still open after ${daysOpen} days.`,
    };
  });
}

async function findDocuments(tenantId, rule) {
  // Document expiry comes from Phase 38 Track 7 (TrackedDocument). Until that
  // migration exists, there is nothing to remind about — skip gracefully.
  if (!prisma.trackedDocument) return [];
  const today = startOfToday();
  const where = { tenantId };
  if (rule.timing === 'before') {
    where.expiresAt = { gte: today, lte: addDays(today, rule.daysOffset) };
  } else {
    where.expiresAt = { lte: addDays(today, -rule.daysOffset) };
  }
  let rows;
  try {
    rows = await prisma.trackedDocument.findMany({
      where,
      include: { member: { select: { id: true, name: true, email: true, phone: true } } },
      take: 2000,
    });
  } catch {
    return [];
  }
  return rows
    .map((d) => {
      const contact = d.memberId ? memberContact(d.member) : null;
      if (!contact) return null;
      const vars = {
        memberName: contact.name,
        title: d.title,
        expiresAt: fmtDate(d.expiresAt),
      };
      return {
        entityId: d.id,
        label: `${d.title} — expires ${fmtDate(d.expiresAt)}`,
        contact,
        vars,
        smsText: `Reminder: your document "${d.title}" expires on ${fmtDate(d.expiresAt)}. Please renew it.`,
        pushTitle: 'Document expiry reminder',
        pushBody: `"${d.title}" expires on ${fmtDate(d.expiresAt)}.`,
      };
    })
    .filter(Boolean);
}

const FINDERS = {
  invoice: findInvoices,
  contract: findContracts,
  booking: findBookings,
  maintenance: findMaintenance,
  document: findDocuments,
};

async function findDue(tenantId, rule) {
  const fn = FINDERS[rule.entity];
  if (!fn) return [];
  try {
    return await fn(tenantId, rule);
  } catch (err) {
    console.error(`[reminders] finder failed for ${rule.entity}:`, err.message);
    return [];
  }
}

// ---------- sending ----------
async function sendOne(tenantId, rule, item) {
  const template = rule.templateKey || DEFAULT_TEMPLATES[rule.entity];
  const sent = [];
  const contact = item.contact;

  for (const ch of rule.channels || []) {
    try {
      if (ch === 'email' && contact && contact.email) {
        let res = await notify(tenantId, contact.email, template, item.vars);
        if (!res || res.sent === false) {
          // Unknown templateKey override -> fall back to the entity default.
          res = await notify(tenantId, contact.email, DEFAULT_TEMPLATES[rule.entity], item.vars);
        }
        if (res && res.sent !== false) sent.push('email');
      } else if (ch === 'sms' && contact && contact.phone) {
        await sendSms(tenantId, contact.phone, item.smsText);
        sent.push('sms');
      } else if (ch === 'push') {
        let userId = item.userId || null;
        if (!userId && contact && contact.memberId) {
          userId = await memberUserId(tenantId, contact.memberId);
        }
        if (userId) {
          await sendPushToUser(userId, { title: item.pushTitle, body: item.pushBody, tag: `reminder-${rule.id}` });
          sent.push('push');
        }
      }
    } catch (err) {
      console.error(`[reminders] channel ${ch} failed for ${item.entityId}:`, err.message);
    }
  }
  return sent;
}

async function runReminderEngine(tenantId, opts = {}) {
  const { dryRun = false } = opts;
  if (!modelsReady()) {
    return { ok: false, error: 'Reminders not available yet (migration pending)' };
  }
  const rules = await prisma.reminderRule.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  const results = [];
  for (const rule of rules) {
    if (!ENTITIES.includes(rule.entity)) {
      results.push({ ruleId: rule.id, name: rule.name, skipped: 'unknown entity' });
      continue;
    }
    const due = await findDue(tenantId, rule);
    const logged = await prisma.reminderLog.findMany({
      where: { ruleId: rule.id },
      select: { entityId: true },
    });
    const loggedSet = new Set(logged.map((l) => l.entityId));
    const fresh = due.filter((d) => !loggedSet.has(d.entityId));

    if (dryRun) {
      results.push({
        ruleId: rule.id,
        name: rule.name,
        entity: rule.entity,
        count: fresh.length,
        sample: fresh.slice(0, 5).map((d) => ({ entityId: d.entityId, label: d.label })),
      });
      continue;
    }

    let sent = 0;
    for (const item of fresh) {
      if (!item.contact) continue;
      const channelsSent = await sendOne(tenantId, rule, item);
      try {
        await prisma.reminderLog.create({
          data: { ruleId: rule.id, tenantId, entityId: item.entityId, channelsSent },
        });
      } catch {
        // Unique (ruleId, entityId) race — already logged, move on.
      }
      sent += 1;
    }
    results.push({ ruleId: rule.id, name: rule.name, entity: rule.entity, due: due.length, sent });
  }
  return { ok: true, rules: results.length, results };
}

async function processAllTenants() {
  if (!modelsReady()) return { ok: false, error: 'migration pending' };
  const tenants = await prisma.tenant.findMany({
    where: { reminderRules: { some: { isActive: true } } },
    select: { id: true },
  });
  const out = [];
  for (const t of tenants) {
    try {
      out.push({ tenantId: t.id, ...(await runReminderEngine(t.id)) });
    } catch (err) {
      out.push({ tenantId: t.id, ok: false, error: String((err && err.message) || err) });
    }
  }
  return { ok: true, tenants: out.length, out };
}

// ---------- job registration (idempotent, dunning pattern) ----------
function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.enqueue === 'function' && typeof j.registerHandler === 'function') return j;
  } catch {
    /* job queue not available */
  }
  return null;
}

(function registerRemindersHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__remindersRegistered) return;
  jobs.__remindersRegistered = true;
  jobs.registerHandler('reminders', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return runReminderEngine(p.tenantId);
    return processAllTenants();
  });
})();

module.exports = {
  ENTITIES,
  CHANNELS,
  ENTITY_LABELS,
  runReminderEngine,
  processAllTenants,
  findDue,
};
