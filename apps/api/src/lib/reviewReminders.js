// Phase 42 Track 5: Performance review cycle reminders.
// Har quarter start par managers ko notification: "Q-n ke reviews ab due hain".
//
// Coordinator wiring (server.js, additive):
//   require('./lib/reviewReminders');
//   require('./lib/reviewReminders').ensureReviewRemindersScheduled();
const prisma = require('./prisma');
const { createNotification } = require('./notify');

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

function currentQuarterKey() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function isQuarterStart() {
  const d = new Date();
  // Quarter ka pehla hafte (month 0,3,6,9 ki pehli 7 dates) — reminder window.
  return [0, 3, 6, 9].includes(d.getMonth()) && d.getDate() <= 7;
}

async function processReviewReminders() {
  const result = { ok: true, notified: 0, quarter: currentQuarterKey() };
  try {
    if (!isQuarterStart()) return { ...result, skipped: 'quarter start window nahi hai' };
    if (!prisma.tenant) return result;
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true }, select: { id: true },
    }).catch(() => []);
    for (const t of tenants) {
      try {
        if (prisma.performanceReview) {
          const existing = await prisma.performanceReview.count({
            where: { tenantId: t.id, period: currentQuarterKey(), status: { in: ['submitted', 'acknowledged'] } },
          });
          if (existing > 0) continue; // reviews already chal rahe hain
        }
        await createNotification(prisma, {
          tenantId: t.id,
          role: 'manager',
          type: 'review.cycle_due',
          message: `${currentQuarterKey()} ke performance reviews ka cycle shuru ho gaya hai — employees ke reviews likh kar submit karein.`,
        }).catch(() => {});
        result.notified += 1;
      } catch { /* ek tenant fail ho to baqi chalte rahein */ }
    }
    // Khud ko kal ke liye dobara schedule karo (nightly self-rescheduling).
    const jobs = getJobs();
    if (jobs) await jobs.enqueue('review-reminders', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
  } catch (e) {
    console.error('[review-reminders]', e.message);
    result.ok = false;
  }
  return result;
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('review-reminders', processReviewReminders);
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

// Boot par ensure karo ke daily run scheduled hai (docExpiryJob wala pattern).
async function ensureReviewRemindersScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs || !prisma.job) return;
    const pending = await prisma.job.count({
      where: { type: 'review-reminders', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const tonight = new Date();
      tonight.setHours(3, 0, 0, 0);
      if (tonight.getTime() < Date.now()) tonight.setDate(tonight.getDate() + 1);
      await jobs.enqueue('review-reminders', {}, { runAt: tonight });
    }
  } catch (e) {
    console.error('[review-reminders] ensure schedule failed:', e.message);
  }
}

module.exports = { processReviewReminders, ensureReviewRemindersScheduled, currentQuarterKey, isQuarterStart };
