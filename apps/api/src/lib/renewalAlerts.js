// Phase 29 Track 4: Contract expiry alerts — in-app notifications at 30/14/7 days.
const prisma = require('./prisma');

const ALERT_WINDOWS = [30, 14, 7]; // days before expiry

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.registerHandler === 'function') return j;
    return null;
  } catch {
    return null;
  }
}

// Create in-app notifications for contracts expiring within the alert windows.
// Idempotent per day: skips contracts already notified today for the same window.
async function checkExpiringContracts() {
  const now = new Date();
  const results = { checked: 0, notified: 0 };
  for (const days of ALERT_WINDOWS) {
    const from = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const contracts = await prisma.contract.findMany({
      where: {
        status: 'active',
        endDate: { not: null, gte: from, lte: to },
      },
      include: {
        member: { select: { name: true } },
        unit: { select: { code: true } },
      },
    });
    results.checked += contracts.length;
    for (const c of contracts) {
      const marker = `[expiry:${days}d]`;
      const already = await prisma.notification.findFirst({
        where: {
          tenantId: c.tenantId,
          type: 'contract_expiry',
          message: { contains: marker },
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      });
      if (already) continue;
      const msg = `${marker} Contract for ${c.member?.name || 'member'} (${c.unit?.code || 'unit'}) expires in ${days} days (${c.endDate.toISOString().slice(0, 10)}). Renew soon.`;
      // Notify tenant staff (ceo/admin/manager) via role-targeted notifications
      for (const role of ['ceo', 'admin', 'manager']) {
        await prisma.notification.create({
          data: {
            tenantId: c.tenantId,
            role,
            type: 'contract_expiry',
            message: msg,
          },
        });
      }
      results.notified += 1;
      // Phase 38: automation rules — fire-and-forget
      require('./automationEngine').evaluateAutomation(c.tenantId, 'contract_expiring', {
        contractId: c.id, memberName: c.member?.name, unitCode: c.unit?.code,
        daysLeft: days, endDate: c.endDate, entityId: c.id,
      }).catch(() => {});
    }
  }
  return results;
}

// Register as a background job handler when the job queue is available.
(function registerRenewalHandler() {
  const jobs = getJobs();
  if (!jobs) return;
  jobs.registerHandler('renewal-check', async () => {
    return checkExpiringContracts();
  });
})();

module.exports = { checkExpiringContracts, ALERT_WINDOWS };
