// Phase 34 Track 2: Asset Management — overdue checkout alert job.
// Finds checkouts past their due date and emails tenant admins once per day per checkout.
const prisma = require('./prisma');

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const lastAlertAt = new Map(); // checkoutId -> timestamp

async function findOverdue(tenantId) {
  const where = { returnedAt: null, dueAt: { lt: new Date() } };
  if (tenantId) where.tenantId = tenantId;
  return prisma.facilityAssetCheckout.findMany({
    where,
    include: {
      asset: { select: { id: true, name: true } },
      member: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { dueAt: 'asc' },
  });
}

async function alertOverdue(tenantId) {
  const overdue = await findOverdue(tenantId);
  if (!overdue.length) return { overdue: 0, sent: 0 };

  const now = Date.now();
  const fresh = overdue.filter((c) => now - (lastAlertAt.get(c.id) || 0) > ALERT_COOLDOWN_MS);
  if (!fresh.length) return { overdue: overdue.length, sent: 0, skipped: true };

  const byTenant = {};
  for (const c of fresh) (byTenant[c.tenantId] = byTenant[c.tenantId] || []).push(c);

  const mailer = require('./mailer');
  let sent = 0;
  for (const [tid, items] of Object.entries(byTenant)) {
    let admins = [];
    try {
      admins = await prisma.user.findMany({
        where: { tenantId: tid, role: { in: ['ceo', 'admin', 'super_admin'] }, email: { not: null } },
        select: { email: true, name: true },
      });
    } catch {
      continue;
    }
    const list = items
      .map((c) => {
        const holder = c.member?.name || c.user?.name || 'Unknown';
        const days = Math.floor((now - new Date(c.dueAt).getTime()) / 86400000);
        return `${c.asset.name} — ${holder} (due ${days} day${days === 1 ? '' : 's'} ago)`;
      })
      .join('\n');
    for (const a of admins) {
      try {
        const r = await mailer.notify(tid, a.email, 'assetOverdue', {
          name: a.name || 'Admin',
          count: items.length,
          list,
        });
        if (r && (r.sent || r.queued)) {
          sent += 1;
          for (const c of items) lastAlertAt.set(c.id, now);
        }
      } catch { /* one bad recipient must not break the rest */ }
    }
  }
  return { overdue: overdue.length, sent };
}

async function processAllTenants() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let overdue = 0;
  let sent = 0;
  for (const t of tenants) {
    const r = await alertOverdue(t.id);
    overdue += r.overdue;
    sent += r.sent || 0;
  }
  return { overdue, sent, tenants: tenants.length };
}

// Auto-register with the job queue (idempotent pattern).
(() => {
  let jobs;
  try {
    jobs = require('./jobs');
  } catch {
    return;
  }
  if (!jobs || jobs.__assetOverdueRegistered) return;
  jobs.__assetOverdueRegistered = true;
  jobs.registerHandler('asset-overdue', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) return alertOverdue(p.tenantId);
    return processAllTenants();
  });
})();

module.exports = { findOverdue, alertOverdue, processAllTenants };
