// Phase 44 Track 8: Event ticket email automation — confirmation, 24h reminders, post-event thanks.
// No migration: EventTicket model Track 3 ka hai (guarded — merge na hua ho to gracefully skip).
//
// Coordinator wiring (server.js, additive):
//   require('./lib/eventEmails');
//   require('./lib/eventEmails').ensureEventEmailsScheduled();
//
// Track 3 integration (routes/event-tickets.js — purchase success ke baad, fire-and-forget):
//   try { const { sendTicketConfirmation } = require('../lib/eventEmails');
//     sendTicketConfirmation({ tenantId: tf.tenantId, ticket }).catch(() => {}); } catch {}
const prisma = require('./prisma');
const { notify } = require('./mailer');

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

function hasTickets() {
  return !!prisma.eventTicket;
}

function fmtWhen(d) {
  try {
    return new Date(d).toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(d || ''); }
}

function esc(s) {
  return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

// --- 1. Purchase confirmation: ticket + QR code (track 3 purchase flow se call hota hai) ---
async function sendTicketConfirmation({ tenantId, ticket }) {
  if (!hasTickets() || !ticket) return { ok: false, reason: 'not_migrated' };
  const t = ticket.event ? ticket : await prisma.eventTicket.findUnique({
    where: { id: ticket.id || ticket },
    include: { event: true, ticketType: true },
  }).catch(() => null);
  if (!t || !t.buyerEmail) return { ok: false, reason: 'no_email' };
  const ev = t.event || {};
  try {
    await notify(tenantId || t.tenantId, t.buyerEmail, 'eventTicket', {
      buyerName: t.buyerName || 'Guest',
      eventTitle: ev.title || 'Event',
      eventWhen: fmtWhen(ev.startsAt),
      eventLocation: ev.location || 'Techub',
      ticketCode: t.code,
      ticketType: (t.ticketType && t.ticketType.name) || '',
      qty: 1,
      price: t.price,
    });
    return { ok: true };
  } catch (err) {
    console.error('[event-emails] ticket confirmation failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

// Dedupe helper: per event ek dafa (audit_logs, milestones wali pattern).
async function alreadyMailed(tenantId, eventId, kind) {
  const row = await prisma.auditLog.findFirst({
    where: { tenantId, action: `event-ticket.${kind}`, entity: 'CommunityEvent', entityId: eventId },
    select: { id: true },
  }).catch(() => null);
  return !!row;
}
async function markMailed(tenantId, eventId, kind, label) {
  await prisma.auditLog.create({
    data: { tenantId, action: `event-ticket.${kind}`, entity: 'CommunityEvent', entityId: eventId, newValue: { label } },
  }).catch(() => {});
}

async function ticketHolders(eventId) {
  return prisma.eventTicket.findMany({
    where: { eventId, status: 'valid', buyerEmail: { not: null } },
    select: { id: true, tenantId: true, buyerName: true, buyerEmail: true },
  }).catch(() => []);
}

// --- 2. 24h reminder: kal hone wale events ke sab ticket holders ko ---
async function runTicketReminders(payload = {}) {
  if (!hasTickets()) return { ok: false, reason: 'not_migrated' };
  const now = new Date();
  const from = new Date(now.getTime() + 20 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 28 * 60 * 60 * 1000);
  const events = await prisma.communityEvent.findMany({
    where: { status: { in: ['upcoming', 'ongoing'] }, startsAt: { gte: from, lte: to } },
    take: 20,
  }).catch(() => []);
  let sent = 0;
  for (const ev of events) {
    if (await alreadyMailed(ev.tenantId, ev.id, 'reminder')) continue;
    const holders = await ticketHolders(ev.id);
    for (const h of holders) {
      try {
        await notify(h.tenantId || ev.tenantId, h.buyerEmail, 'eventReminder', {
          memberName: h.buyerName || 'Guest',
          eventTitle: ev.title,
          eventWhen: fmtWhen(ev.startsAt),
          eventLocation: ev.location || 'Techub',
        });
        sent++;
      } catch (err) {
        console.error(`[event-emails] reminder failed for ${h.buyerEmail}:`, err.message);
      }
    }
    await markMailed(ev.tenantId, ev.id, 'reminder', `${holders.length} ticket reminders`);
  }
  // Agli daily run schedule karo (docExpiryJob pattern).
  try {
    const jobs = getJobs();
    if (jobs) await jobs.enqueue('event-ticket-emails', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
  } catch { /* ignore */ }
  return { ok: true, sent, events: events.length };
}

// --- 3. Post-event thanks + feedback survey link (event ke 1 din baad) ---
async function runTicketThanks(payload = {}) {
  if (!hasTickets()) return { ok: false, reason: 'not_migrated' };
  const now = new Date();
  const from = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const to = new Date(now.getTime() - 20 * 60 * 60 * 1000);
  const events = await prisma.communityEvent.findMany({
    where: { status: { not: 'cancelled' }, endsAt: { gte: from, lte: to } },
    take: 20,
  }).catch(() => []);
  let sent = 0;
  for (const ev of events) {
    if (await alreadyMailed(ev.tenantId, ev.id, 'thanks')) continue;
    const holders = await ticketHolders(ev.id);
    for (const h of holders) {
      try {
        await notify(h.tenantId || ev.tenantId, h.buyerEmail, 'eventThanks', {
          buyerName: h.buyerName || 'Guest',
          eventTitle: ev.title,
          feedbackUrl: process.env.FRONTEND_URL
            ? `${process.env.FRONTEND_URL.replace(/\/$/, '')}/portal/surveys`
            : '',
        });
        sent++;
      } catch (err) {
        console.error(`[event-emails] thanks failed for ${h.buyerEmail}:`, err.message);
      }
    }
    await markMailed(ev.tenantId, ev.id, 'thanks', `${holders.length} thank-you emails`);
  }
  return { ok: true, sent, events: events.length };
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('event-ticket-emails', async () => {
        const r = await runTicketReminders();
        const t = await runTicketThanks();
        return { reminders: r, thanks: t };
      });
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

// Boot par ensure karo ke daily run scheduled hai (backup.js wala pattern).
async function ensureEventEmailsScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'event-ticket-emails', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const morning = new Date();
      morning.setHours(6, 0, 0, 0);
      if (morning.getTime() < Date.now()) morning.setDate(morning.getDate() + 1);
      await jobs.enqueue('event-ticket-emails', {}, { runAt: morning });
    }
  } catch (e) {
    console.error('[event-emails] ensure schedule failed:', e.message);
  }
}

module.exports = { sendTicketConfirmation, runTicketReminders, runTicketThanks, ensureEventEmailsScheduled };
