// Phase 34 Track 1: Shift reminder job — notifies staff 2h before their shift.
// Runs via the job queue (registerHandler('shift-reminder', ...)).
const prisma = require('./prisma');
const { notify } = require('./mailer');

async function processShiftReminders() {
  const now = new Date();
  const from = new Date(now.getTime() + 90 * 60 * 1000);  // 1.5h ahead
  const to = new Date(now.getTime() + 150 * 60 * 1000);   // 2.5h ahead

  // Find shifts whose start time falls in the reminder window today.
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const shifts = await prisma.shift.findMany({
    where: {
      date: { gte: dayStart, lt: dayEnd },
      reminderSentAt: null,
    },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    take: 50,
  });

  let sent = 0;
  for (const s of shifts) {
    const [h, m] = String(s.startTime).split(':').map(Number);
    const start = new Date(s.date); start.setUTCHours(h, m, 0, 0);
    if (start < from || start > to) continue;
    const u = s.user;
    if (!u || !u.isActive || !u.email) {
      // Still mark sent so the job never retries a dead shift.
      await prisma.shift.update({ where: { id: s.id }, data: { reminderSentAt: new Date() } }).catch(() => {});
      continue;
    }
    try {
      const when = start.toLocaleString('en-PK', {
        timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      });
      await notify(s.tenantId, u.email, 'shiftReminder', {
        name: u.name || 'there',
        shiftWhen: when,
        startTime: s.startTime,
        endTime: s.endTime,
        shiftRole: s.role || 'your shift',
      });
      sent++;
    } catch (err) {
      console.error(`[shift-reminder] failed for ${u.email}:`, err.message);
    }
    // Idempotent: mark sent so re-runs in the same window never spam staff.
    await prisma.shift.update({ where: { id: s.id }, data: { reminderSentAt: new Date() } }).catch(() => {});
  }
  return { sent, checked: shifts.length };
}

// Auto-register with the job queue when available (module load = coordinator
// only needs `require('./lib/shiftReminderJob')` in server.js).
(function register() {
  try {
    const jobs = require('./jobs');
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('shift-reminder', async () => processShiftReminders());
    }
  } catch {
    /* jobs module not present — coordinator merges it later */
  }
})();

module.exports = { processShiftReminders };
