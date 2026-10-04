// Phase 54 Track 5: First-Booking Nudge
// ---------------------------------------------------------------
// `nudgeMembers()` — members jo 7+ din se hain lekin abhi tak koi
// booking nahi ki → in-app Notification + email reminder.
//
// Dedupe (migration nahi — Track 5 rule): Notification message me
// marker prefix `[first-booking-nudge:<memberId>]` rakha jata hai;
// dobara bhejne se pehle pichle 14 din me us member ke liye koi
// aisi Notification exist karti hai ya nahi, check hoti hai.
// Coordinator baad me isay Member par dedicated flag me badal sakta hai.
//
// COORDINATOR WIRING NOTE (server.js additive):
//   require('./lib/firstBookingNudge');
//   require('./lib/firstBookingNudge').ensureFirstBookingNudge();
//   Job 'first-booking-nudge' roz subah chale (ya manual trigger).
// ---------------------------------------------------------------
const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

const MARKER_PREFIX = '[first-booking-nudge:';
const DEDUPE_DAYS = 14;
const MIN_DAYS_SINCE_JOIN = 7;

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.registerHandler === 'function') return j;
  } catch {
    /* job queue not available */
  }
  return null;
}

function schemaReady() {
  try {
    return !!(prisma.member && prisma.booking && prisma.notification);
  } catch {
    return false;
  }
}

function markerFor(memberId) {
  return `${MARKER_PREFIX}${memberId}]`;
}

async function wasNudgedRecently(tenantId, memberId) {
  const since = new Date(Date.now() - DEDUPE_DAYS * 24 * 60 * 60 * 1000);
  const existing = await prisma.notification.findFirst({
    where: {
      tenantId,
      message: { startsWith: markerFor(memberId) },
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return !!existing;
}

function emailBody(member, bookingUrl) {
  return `
    <p>Hi ${member.name || 'there'},</p>
    <p>Welcome! We noticed you haven't booked a space yet. Your membership
    includes easy access to meeting rooms, desks and more.</p>
    <p><a href="${bookingUrl}">Book your first space now</a> — it only takes a minute.</p>
    <p>Need help choosing? Just reply to this email.</p>
  `;
}

async function nudgeMember(tenantId, member, opts = {}) {
  // 1) Dedupe check (flag ke bajaye — migration nahi allowed)
  if (await wasNudgedRecently(tenantId, member.id)) {
    return { nudged: false, reason: 'already_nudged' };
  }

  const message =
    `${markerFor(member.id)} Hi ${member.name || 'there'}! You joined ` +
    `${MIN_DAYS_SINCE_JOIN}+ days ago but haven't booked a space yet. ` +
    `Open Bookings to grab your first slot.`;

  // 2) In-app notification (agar member ka linked login (User) hai to direct,
  //    warna staff ko general notification taake follow-up ho sake)
  try {
    await prisma.notification.create({
      data: {
        tenantId,
        userId: member.user?.id || null,
        type: 'general',
        message,
      },
    });
  } catch {
    /* notification non-fatal */
  }

  // 3) Email reminder
  let emailed = false;
  if (member.email) {
    try {
      await sendEmail(tenantId, {
        to: member.email,
        subject: 'Book your first space with us',
        html: emailBody(member, opts.bookingUrl || ''),
      });
      emailed = true;
    } catch {
      /* email fail-safe — notification already sent */
    }
  }

  return { nudged: true, emailed, notified: true };
}

async function processTenant(tenantId, opts = {}) {
  if (!schemaReady()) return { skipped: true };

  const cutoff = new Date(Date.now() - MIN_DAYS_SINCE_JOIN * 24 * 60 * 60 * 1000);

  // 7+ din purane, active/trial members jinke ZERO bookings hain
  const candidates = await prisma.member.findMany({
    where: {
      tenantId,
      status: { in: ['active', 'trial'] },
      createdAt: { lte: cutoff },
      bookings: { none: {} },
    },
    select: { id: true, name: true, email: true, user: { select: { id: true } }, createdAt: true },
  });

  let nudged = 0, skipped = 0, emailed = 0;
  for (const m of candidates) {
    const r = await nudgeMember(tenantId, m, opts);
    if (r.nudged) { nudged++; if (r.emailed) emailed++; }
    else skipped++;
  }
  return { checked: candidates.length, nudged, skipped, emailed };
}

async function nudgeMembers(opts = {}) {
  if (!schemaReady()) return { skipped: true };
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true }, select: { id: true },
  });
  const out = [];
  for (const t of tenants) {
    out.push({ tenantId: t.id, ...(await processTenant(t.id, opts)) });
  }
  return out;
}

// Job handler auto-register (idempotent) — daily wiring coordinator karega.
(function registerFirstBookingNudgeHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__firstBookingNudgeRegistered) return;
  jobs.__firstBookingNudgeRegistered = true;
  jobs.registerHandler('first-booking-nudge', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return processTenant(p.tenantId, p);
    return nudgeMembers(p);
  });
})();

async function ensureFirstBookingNudge() {
  // Coordinator: isay server.js boot me call kare (jaise baqi ensure* hain).
  const jobs = getJobs();
  if (jobs && typeof jobs.scheduleRecurring === 'function') {
    await jobs.scheduleRecurring('first-booking-nudge', { cron: '0 8 * * *' });
  }
  return { registered: true };
}

module.exports = { nudgeMembers, processTenant, nudgeMember, ensureFirstBookingNudge };
