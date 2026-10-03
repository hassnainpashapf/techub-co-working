// Phase 45 Track 4: Weekly AI Insights Engine.
// Rule-based detectors jo asal tenant data se har Monday insights banate hain.
// LLM available ho (Track 1 aiProvider) to body polish hoti hai — warna rule
// text hi use hota hai. Koi crash nahi: har detector try/catch me hai.
//
// Coordinator wiring (server.js):
//   require('./lib/insightEngine');              // 'weekly-insights' handler auto-register
//   require('./lib/insightEngine').ensureInsightsScheduled(); // Monday 7am ensure
const prisma = require('./prisma');

const DAY = 86400000;

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

// Us week ka Monday (00:00 local → UTC date).
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Monday=0
  return new Date(d.getTime() - dow * DAY);
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ---------- Detectors (har ek { type, title, body, severity, data } ya null) ----------

// Revenue: pichhle 7 din vs us se pichhle 7 din (payments.paidAt). Drop > 15% → warning.
async function detectRevenue(tf) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY);
  const rows = await prisma.payment.findMany({
    where: { ...tf, paidAt: { gte: twoWeeksAgo } },
    select: { amount: true, paidAt: true },
  });
  let thisWeek = 0, lastWeek = 0;
  for (const p of rows) {
    const a = Number(p.amount) || 0;
    if (new Date(p.paidAt).getTime() >= weekAgo.getTime()) thisWeek += a; else lastWeek += a;
  }
  if (lastWeek <= 0) return null;
  const dropPct = ((lastWeek - thisWeek) / lastWeek) * 100;
  if (dropPct <= 15) return null;
  return {
    type: 'revenue',
    title: `Revenue down ${dropPct.toFixed(1)}% vs last week`,
    body: `Is hafte collections ${fmt(thisWeek)} hain, pichhle hafte ${fmt(lastWeek)} thay — ${dropPct.toFixed(1)}% ki girawat. Dunning queue aur overdue invoices check karein.`,
    severity: dropPct > 35 ? 'critical' : 'warning',
    data: { thisWeek: Math.round(thisWeek), lastWeek: Math.round(lastWeek), dropPct: Math.round(dropPct * 10) / 10 },
  };
}

// Occupancy: units me occupied ratio < 60% → warning.
async function detectOccupancy(tf) {
  const [total, occupied] = await Promise.all([
    prisma.unit.count({ where: { ...tf, status: { not: 'maintenance' } } }),
    prisma.unit.count({ where: { ...tf, status: 'occupied' } }),
  ]);
  if (total <= 0) return null;
  const pct = (occupied / total) * 100;
  if (pct >= 60) return null;
  return {
    type: 'occupancy',
    title: `Occupancy low at ${pct.toFixed(0)}%`,
    body: `${occupied} / ${total} units occupied — 60% target se neeche. Vacant units ke liye marketing push ya promo pricing par ghor karein.`,
    severity: pct < 40 ? 'critical' : 'warning',
    data: { occupied, total, pct: Math.round(pct * 10) / 10 },
  };
}

// Churn: halka heuristic score (>=25 at-risk). >3 at-risk members → critical.
async function detectChurn(tf) {
  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * DAY);
  const contractCutoff = new Date(now.getTime() + 30 * DAY);
  const members = await prisma.member.findMany({
    where: { ...tf, status: { in: ['active', 'trial', 'on_hold'] } },
    select: {
      id: true,
      invoices: { where: { status: { in: ['overdue', 'unpaid'] }, dueDate: { lt: now } }, select: { id: true } },
      bookings: { where: { createdAt: { gte: cutoff30 } }, select: { id: true } },
      contracts: { where: { status: 'active', endDate: { lte: contractCutoff } }, select: { id: true } },
    },
  });
  const atRisk = members.filter((m) => {
    let s = 0;
    if (m.invoices.length > 0) s += 30;
    if (m.bookings.length === 0) s += 20;
    if (m.contracts.length > 0) s += 20;
    return s >= 25;
  }).length;
  if (atRisk <= 3) return null;
  return {
    type: 'churn',
    title: `${atRisk} members at churn risk`,
    body: `${atRisk} active members churn-risk par hain (overdue dues, 30 din me booking nahi, ya contract khatm honay wala). Retention offers bhejein.`,
    severity: 'critical',
    data: { atRisk, checked: members.length },
  };
}

// Billing: overdue invoices spike. 5+ overdue → warning; total overdue amount bhi.
async function detectBilling(tf) {
  const now = new Date();
  const overdue = await prisma.invoice.findMany({
    where: { ...tf, status: { in: ['overdue', 'unpaid'] }, dueDate: { lt: now } },
    select: { amount: true, amountPaid: true },
  });
  if (overdue.length <= 5) return null;
  const total = overdue.reduce((s, i) => s + (Number(i.amount) || 0) - (Number(i.amountPaid) || 0), 0);
  return {
    type: 'billing',
    title: `${overdue.length} overdue invoices`,
    body: `${overdue.length} invoices overdue hain — kul ${fmt(total)} baqaya. Dunning automation chal rahi hai; bari raqmon par manual follow-up karein.`,
    severity: overdue.length > 15 ? 'critical' : 'warning',
    data: { overdueCount: overdue.length, overdueAmount: Math.round(total) },
  };
}

// Leases: agle 30 din me khatm honay walay active contracts → warning.
async function detectLeases(tf) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + 30 * DAY);
  const expiring = await prisma.contract.findMany({
    where: { ...tf, status: 'active', endDate: { gte: now, lte: cutoff } },
    select: { id: true, endDate: true, member: { select: { name: true } } },
    take: 10,
  });
  if (expiring.length === 0) return null;
  const names = expiring.slice(0, 5).map((c) => c.member?.name || '—').join(', ');
  return {
    type: 'leases',
    title: `${expiring.length} contracts expiring in 30 days`,
    body: `Agle 30 din me ${expiring.length} contracts khatm ho rahe hain (${names}${expiring.length > 5 ? '…' : ''}). Renewal offers bhejein taake churn na ho.`,
    severity: 'warning',
    data: { expiringCount: expiring.length, sample: names },
  };
}

const DETECTORS = [detectRevenue, detectOccupancy, detectChurn, detectBilling, detectLeases];

// LLM polish: sirf jab Track 1 client available ho. Fail-safe — original body wapas.
async function polishBodies(tenantId, insights) {
  try {
    const { getAiClient } = require('./aiProvider');
    const client = await getAiClient(tenantId);
    if (!client || !client.available) return insights;
    const out = [];
    for (const ins of insights) {
      try {
        const r = await client.chat(
          [{ role: 'user', content: `Ek coworking space manager ke liye ye weekly alert 2 jumlon me wazeh aur actionable banao (Roman Urdu me): "${ins.title}". Data: ${JSON.stringify(ins.data)}. Sirf body text do.` }],
          { maxTokens: 120, temperature: 0.4, system: 'Tum coworking space ke operations advisor ho. Jawab hamesha Roman Urdu me do.' }
        );
        out.push({ ...ins, body: (r && r.text ? r.text.trim() : ins.body) });
      } catch { out.push(ins); }
    }
    return out;
  } catch { return insights; }
}

// Ek tenant ke liye is week ke insights generate + upsert karo.
async function generateWeeklyInsights(tenantId, { polish = true } = {}) {
  if (!prisma.insight) {
    console.error('[insights] Insight model not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }
  const tf = { tenantId };
  const week = mondayOf(new Date());
  const insights = [];
  for (const detect of DETECTORS) {
    try {
      const ins = await detect(tf);
      if (ins) insights.push(ins);
    } catch (e) {
      console.error(`[insights] detector failed:`, e.message);
    }
  }
  const finalInsights = polish ? await polishBodies(tenantId, insights) : insights;
  let saved = 0;
  for (const ins of finalInsights) {
    try {
      await prisma.insight.upsert({
        where: { tenantId_week_type: { tenantId, week, type: ins.type } },
        update: { title: ins.title, body: ins.body, severity: ins.severity, data: ins.data || null, isRead: false },
        create: { tenantId, week, type: ins.type, title: ins.title, body: ins.body, severity: ins.severity, data: ins.data || null },
      });
      saved++;
    } catch (e) {
      console.error('[insights] upsert failed:', e.message);
    }
  }
  return { ok: true, week, generated: saved };
}

// Job handler: sab tenants ke liye generate (payload optional: { tenantId }).
async function processWeeklyInsights(payload = {}) {
  let tenants;
  if (payload.tenantId) {
    tenants = [{ id: payload.tenantId }];
  } else {
    tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } }).catch(() => []);
  }
  let done = 0, failed = 0;
  for (const t of tenants) {
    try {
      const r = await generateWeeklyInsights(t.id);
      if (r.ok) done++; else failed++;
    } catch (e) {
      failed++;
      console.error(`[insights] tenant ${t.id} failed:`, e.message);
    }
  }
  return { ok: true, done, failed };
}

// Auto-register handler.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('weekly-insights', processWeeklyInsights);
    }
  } catch { /* jobs module merge nahi hua — coordinator baad me kare */ }
})();

// Boot par ensure: agla Monday 7am pending na ho to enqueue karo.
async function ensureInsightsScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'weekly-insights', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const next = mondayOf(new Date(Date.now() + 7 * DAY));
      next.setHours(7, 0, 0, 0);
      await jobs.enqueue('weekly-insights', {}, { runAt: next });
    }
  } catch (e) {
    console.error('[insights] ensure schedule failed:', e.message);
  }
}

module.exports = {
  generateWeeklyInsights,
  processWeeklyInsights,
  ensureInsightsScheduled,
  mondayOf,
};
