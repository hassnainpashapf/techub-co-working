// Phase 34 Track 5: Mail & Package Handling — 7-day uncollected reminder job.
// Coordinator: require this file in server.js (handler auto-registers);
// enqueue { type: 'mail-reminder' } daily.
const prisma = require('./prisma');
const { notify } = require('./mailer');

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.enqueue === 'function' && typeof j.registerHandler === 'function') return j;
  } catch (e) { /* jobs system not loaded */ }
  return null;
}

async function processMailReminders(tenantId) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const where = {
    tenantId,
    status: { in: ['received', 'notified'] },
    receivedAt: { lte: cutoff },
    reminderSentAt: null,
  };
  const items = await prisma.mailItem.findMany({
    where,
    include: { member: { select: { id: true, name: true, email: true } } },
    take: 100,
  });

  let sent = 0;
  for (const item of items) {
    if (item.member.email) {
      try {
        await notify(tenantId, item.member.email, 'mailReminder', {
          memberName: item.member.name,
          itemType: item.type,
          sender: item.sender,
          trackingNumber: item.trackingNumber,
          receivedAt: item.receivedAt ? new Date(item.receivedAt).toLocaleString() : '',
          daysWaiting: Math.floor((Date.now() - new Date(item.receivedAt).getTime()) / 86400000),
        });
        sent++;
      } catch (e) { /* continue with the rest */ }
    }
    // Idempotent: only mark after attempt (even without email, we tried)
    await prisma.mailItem.update({
      where: { id: item.id },
      data: { reminderSentAt: new Date() },
    }).catch(() => {});
  }
  return { checked: items.length, sent };
}

async function processAllTenants() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let total = { checked: 0, sent: 0 };
  for (const t of tenants) {
    try {
      const r = await processMailReminders(t.id);
      total.checked += r.checked;
      total.sent += r.sent;
    } catch (e) { /* per-tenant isolation */ }
  }
  return total;
}

// Register background handler (idempotent) — coordinator can enqueue {type:'mail-reminder'} daily.
(function registerMailReminderHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__mailReminderRegistered) return;
  jobs.__mailReminderRegistered = true;
  jobs.registerHandler('mail-reminder', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return processMailReminders(p.tenantId);
    return processAllTenants();
  });
})();

module.exports = { processMailReminders, processAllTenants };
