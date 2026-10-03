// Phase 34 Track 6: Printing quota monthly reset job.
// Har naye month ki shuruaat me active members ke liye quota rows pre-allocate.
const prisma = require('./prisma');

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getSettingNum(tenantId, key, def) {
  try {
    const row = await prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key } } });
    const v = parseFloat(row && row.value);
    return Number.isFinite(v) && v >= 0 ? v : def;
  } catch {
    return def;
  }
}

async function resetMonth(tenantId, month) {
  const m = month || currentMonth();
  const quota = Math.floor(await getSettingNum(tenantId, 'printQuotaDefault', 100));
  const members = await prisma.member.findMany({
    where: { tenantId, status: 'active' },
    select: { id: true },
  });
  let created = 0;
  for (const mem of members) {
    const r = await prisma.printCredit.upsert({
      where: { memberId_month: { memberId: mem.id, month: m } },
      update: {},
      create: { tenantId, memberId: mem.id, month: m, includedPages: quota, usedPages: 0 },
    });
    if (r.usedPages === 0) created += 1;
  }
  return { month: m, members: members.length, created };
}

async function processAllTenants() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let created = 0;
  for (const t of tenants) {
    const r = await resetMonth(t.id);
    created += r.created;
  }
  return { month: currentMonth(), tenants: tenants.length, created };
}

// Auto-register with the job queue (dunning wala idempotent pattern).
(() => {
  let jobs;
  try {
    jobs = require('./jobs');
  } catch {
    return;
  }
  if (!jobs || jobs.__printingResetRegistered) return;
  jobs.__printingResetRegistered = true;
  jobs.registerHandler('printing-reset', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return resetMonth(p.tenantId, p.month);
    return processAllTenants();
  });
})();

module.exports = { resetMonth, processAllTenants, currentMonth };
