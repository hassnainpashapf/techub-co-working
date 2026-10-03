// Phase 38 Track 8: Waiting List auto-expiry job.
// Offers expire 48h after being made: entry goes back to `waiting`
// (so the next person in line can be offered) or to `expired` after
// 2 unclaimed offers.
const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

const OFFER_WINDOW_HOURS = 48;

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
    return !!prisma.waitingListEntry;
  } catch {
    return false;
  }
}

async function processTenant(tenantId) {
  if (!schemaReady()) return { skipped: true };
  const cutoff = new Date(Date.now() - OFFER_WINDOW_HOURS * 60 * 60 * 1000);
  const expired = await prisma.waitingListEntry.findMany({
    where: { tenantId, status: 'offered', offeredAt: { lt: cutoff } },
    select: { id: true, name: true, email: true, offersMade: true },
  });
  let backToWaiting = 0;
  let markedExpired = 0;
  for (const e of expired) {
    const final = e.offersMade >= 2;
    await prisma.waitingListEntry.update({
      where: { id: e.id },
      data: final
        ? { status: 'expired' }
        : { status: 'waiting', offeredAt: null, notes: undefined },
    });
    if (final) markedExpired++;
    else backToWaiting++;
    // Nudge the member that their offer lapsed (email only if we have one)
    if (e.email) {
      try {
        await sendEmail(tenantId, {
          to: e.email,
          subject: 'Your space offer has lapsed',
          html: `<p>Hi ${e.name || 'there'},</p><p>Your space offer lapsed after 48 hours without a response. You're back on our waiting list and we'll contact you as soon as another space opens up.</p>`,
        });
      } catch {
        /* non-fatal */
      }
    }
  }
  return { checked: expired.length, backToWaiting, markedExpired };
}

async function processAllTenants() {
  if (!schemaReady()) return { skipped: true };
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const out = [];
  for (const t of tenants) out.push({ tenantId: t.id, ...(await processTenant(t.id)) });
  return out;
}

// Register background handler (idempotent) — coordinator can enqueue {type:'waiting-list-expiry'} daily.
(function registerWaitingListExpiryHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__waitingListExpiryRegistered) return;
  jobs.__waitingListExpiryRegistered = true;
  jobs.registerHandler('waiting-list-expiry', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return processTenant(p.tenantId);
    return processAllTenants();
  });
})();

module.exports = { processTenant, processAllTenants, OFFER_WINDOW_HOURS };
