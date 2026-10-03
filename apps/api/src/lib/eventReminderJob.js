// Phase 33: Event reminder job — emails RSVP'd members 1 day before the event.
// Runs via the job queue (registerHandler('event-reminder', ...)).
const prisma = require('./prisma');
const { notify } = require('./mailer');

async function processEventReminders() {
  const now = new Date();
  const from = new Date(now.getTime() + 20 * 60 * 60 * 1000); // 20h ahead
  const to = new Date(now.getTime() + 28 * 60 * 60 * 1000);   // 28h ahead

  const events = await prisma.communityEvent.findMany({
    where: {
      status: { in: ['upcoming', 'ongoing'] },
      reminderSentAt: null,
      startsAt: { gte: from, lte: to },
    },
    include: {
      rsvps: {
        where: { status: 'going' },
        include: { member: { select: { id: true, name: true, email: true, tenantId: true } } },
      },
    },
    take: 20,
  });

  let sent = 0;
  for (const ev of events) {
    for (const rsvp of ev.rsvps) {
      const m = rsvp.member;
      if (!m || !m.email) continue;
      try {
        const when = new Date(ev.startsAt).toLocaleString('en-PK', {
          timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short',
          hour: '2-digit', minute: '2-digit',
        });
        await notify(m.tenantId || ev.tenantId, m.email, 'eventReminder', {
          memberName: m.name || 'Member',
          eventTitle: ev.title,
          eventWhen: when,
          eventLocation: ev.location || 'Techub',
        });
        sent++;
      } catch (err) {
        console.error(`[event-reminder] failed for ${m.email}:`, err.message);
      }
    }
    // Idempotent: mark sent so re-runs in the same window never spam members.
    await prisma.communityEvent.update({
      where: { id: ev.id },
      data: { reminderSentAt: new Date() },
    }).catch(() => {});
  }
  return { sent, events: events.length };
}

// Auto-register with the job queue when available (module load = coordinator
// only needs `require('./lib/eventReminderJob')` in server.js).
(function register() {
  try {
    const jobs = require('./jobs');
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('event-reminder', async () => processEventReminders());
    }
  } catch {
    /* jobs module not present — coordinator merges it later */
  }
})();

module.exports = { processEventReminders };
