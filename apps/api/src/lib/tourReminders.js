// Phase 39 Track 3: Tour reminders — 24h + 2h before a scheduled tour,
// email + SMS to the lead. Job handler auto-registers; coordinator can
// enqueue {type:'tour-reminders'} (daily/hourly) or per-tenant.
const prisma = require('./prisma');
const { sendEmail } = require('./mailer');
const { sendSms } = require('./sms');

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
  try {
    return !!prisma.tour;
  } catch {
    return false;
  }
}

function fmtWhen(d) {
  return new Date(d).toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function sendReminder(tenantId, tour, kind) {
  const lead = tour.lead || {};
  const when = fmtWhen(tour.scheduledAt);
  const host = tour.assignee?.name ? ` with ${tour.assignee.name}` : '';
  const subject = kind === '24h' ? 'Your tour is tomorrow' : 'Your tour starts soon';
  const text = `Hi ${lead.name || 'there'}, this is a reminder about your tour${host} on ${when}. Reply to reschedule if needed.`;

  if (lead.email) {
    try {
      await sendEmail(tenantId, {
        to: lead.email,
        subject,
        html: `<p>Hi ${lead.name || 'there'},</p><p>This is a reminder about your tour${host} on <strong>${when}</strong>.</p><p>Reply to this email if you need to reschedule.</p>`,
      });
    } catch {
      /* non-fatal */
    }
  }
  if (lead.phone) {
    try {
      await sendSms(tenantId, lead.phone, text);
    } catch {
      /* non-fatal */
    }
  }
  await prisma.tour.update({
    where: { id: tour.id },
    data: kind === '24h' ? { reminder24hSentAt: new Date() } : { reminder2hSentAt: new Date() },
  });
}

async function processTenant(tenantId) {
  if (!schemaReady()) return { skipped: true };
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const due24 = await prisma.tour.findMany({
    where: {
      tenantId, status: 'scheduled', reminder24hSentAt: null,
      scheduledAt: { gt: now, lte: in24h },
    },
    include: { lead: { select: { name: true, email: true, phone: true } }, assignee: { select: { name: true } } },
  });
  const due2 = await prisma.tour.findMany({
    where: {
      tenantId, status: 'scheduled', reminder2hSentAt: null,
      scheduledAt: { gt: now, lte: in2h },
    },
    include: { lead: { select: { name: true, email: true, phone: true } }, assignee: { select: { name: true } } },
  });

  let sent24 = 0, sent2 = 0;
  const sentIds = new Set();
  for (const t of due24) {
    await sendReminder(tenantId, t, '24h');
    sentIds.add(t.id);
    sent24++;
  }
  for (const t of due2) {
    if (sentIds.has(t.id)) continue; // same tour got the 24h reminder this run — don't double-send
    await sendReminder(tenantId, t, '2h');
    sent2++;
  }
  return { checked: due24.length + due2.length, sent24, sent2 };
}

async function processAllTenants() {
  if (!schemaReady()) return { skipped: true };
  const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
  const out = [];
  for (const t of tenants) out.push({ tenantId: t.id, ...(await processTenant(t.id)) });
  return out;
}

// Register background handler (idempotent).
(function registerTourReminderHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__tourRemindersRegistered) return;
  jobs.__tourRemindersRegistered = true;
  jobs.registerHandler('tour-reminders', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return processTenant(p.tenantId);
    return processAllTenants();
  });
})();

module.exports = { processTenant, processAllTenants };
