// Phase 51 Track 10/10: Utilities Dashboard — stats API.
// Coordinator ke liye:
//   Mount: app.use('/api/utilities-dashboard', require('./routes/utilities-dashboard'));
//   Sidebar link: naya "Utilities" section me { label: 'Utilities Dashboard', path: '/utilities' } — roles: ceo/admin/super_admin/manager
//   Schema merge: tracks 1-9 ke models (UtilityMeter, MeterReading, UtilityBill, UtilityRate, GreenInitiative) merge hote hi sections auto-live.
//   Har section defensive hai — model merge na hua ho to wo section null + missing list, poora endpoint 200 rehta hai (koi 500 nahi).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

const hasModel = (name) => Boolean(prisma && prisma[name]);

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Readings se per-meter consumption (window me: last - first reading).
async function consumptionInWindow(tf, meterIds, from) {
  const readings = await prisma.meterReading.findMany({
    where: { ...tf, meterId: { in: meterIds }, readAt: { gte: from } },
    select: { meterId: true, reading: true, readAt: true },
    orderBy: [{ meterId: 'asc' }, { readAt: 'asc' }],
  });
  const byMeter = {};
  for (const r of readings) {
    const v = Number(r.reading);
    if (Number.isNaN(v)) continue;
    if (!byMeter[r.meterId]) byMeter[r.meterId] = { first: v, last: v };
    else byMeter[r.meterId].last = v;
  }
  const out = {};
  for (const [id, v] of Object.entries(byMeter)) {
    const c = v.last - v.first;
    out[id] = c > 0 ? c : 0;
  }
  return out;
}

// ---------------------------------------------------------------- GET /stats
// consumption by type (30d) + utility cost (30d) + unbilled consumption +
// active alerts + green score.
router.get('/stats', async (req, res) => {
  const tf = tenantFilter(req);
  const out = { migrated: {}, missing: [] };
  const w30 = daysAgo(30);
  const w60 = daysAgo(60);

  // --- meters load (defensive)
  let meters = [];
  if (hasModel('utilityMeter') && hasModel('meterReading')) {
    try {
      out.migrated.meters = true;
      meters = await prisma.utilityMeter.findMany({
        where: { ...tf, isActive: true },
        select: { id: true, name: true, type: true },
      });
    } catch { out.migrated.meters = false; out.missing.push('utilityMeter'); }
  } else {
    out.missing.push('utilityMeter', 'meterReading');
  }

  // --- consumption by type (30d) + prev window (trend ke liye)
  let cons30 = {}, consPrev = {};
  const byType30d = [];
  if (meters.length) {
    try {
      const ids = meters.map((m) => m.id);
      cons30 = await consumptionInWindow(tf, ids, w30);
      consPrev = await consumptionInWindow(tf, ids, w60);
      const prevOnly = {};
      for (const [id, v] of Object.entries(consPrev)) prevOnly[id] = v - (cons30[id] || 0);
      const agg = {};
      for (const m of meters) {
        const t = m.type || 'electricity';
        if (!agg[t]) agg[t] = { consumption: 0, prev: 0, meters: 0 };
        agg[t].consumption += cons30[m.id] || 0;
        agg[t].prev += Math.max(0, prevOnly[m.id] || 0);
        agg[t].meters += 1;
      }
      for (const [type, a] of Object.entries(agg)) {
        byType30d.push({
          type,
          consumption: Math.round(a.consumption * 100) / 100,
          prevConsumption: Math.round(a.prev * 100) / 100,
          trendPct: a.prev > 0 ? Math.round(((a.consumption - a.prev) / a.prev) * 100) / 100 : null,
          meters: a.meters,
        });
      }
      out.byType30d = byType30d;
    } catch { out.byType30d = null; out.missing.push('meterReading'); }
  } else {
    out.byType30d = [];
  }

  // --- utility cost (30d): UtilityBill se (track 3)
  let cost30d = null, billCount30d = 0;
  if (hasModel('utilityBill')) {
    try {
      out.migrated.utilityBill = true;
      const agg = await prisma.utilityBill.aggregate({
        where: { ...tf, createdAt: { gte: w30 } },
        _sum: { amount: true }, _count: { id: true },
      });
      cost30d = Number(agg._sum.amount || 0);
      billCount30d = agg._count.id || 0;
    } catch { out.migrated.utilityBill = false; out.missing.push('utilityBill'); }
  } else {
    out.missing.push('utilityBill');
  }
  out.cost30d = cost30d;
  out.billCount30d = billCount30d;

  // --- unbilled consumption: jin meters ka pichhle 30d me koi bill nahi
  let unbilled = null;
  if (meters.length && hasModel('utilityBill')) {
    try {
      const billed = await prisma.utilityBill.findMany({
        where: { ...tf, createdAt: { gte: w30 } },
        select: { meterId: true },
      });
      const billedSet = new Set(billed.map((b) => b.meterId).filter(Boolean));
      const unbilledIds = meters.map((m) => m.id).filter((id) => !billedSet.has(id));
      if (unbilledIds.length) {
        const c = await consumptionInWindow(tf, unbilledIds, w30);
        unbilled = {
          meters: unbilledIds.length,
          consumptionByMeter: Object.fromEntries(
            Object.entries(c).map(([k, v]) => [k, Math.round(v * 100) / 100])
          ),
          totalConsumption: Math.round(Object.values(c).reduce((a, b) => a + b, 0) * 100) / 100,
        };
      } else {
        unbilled = { meters: 0, consumptionByMeter: {}, totalConsumption: 0 };
      }
    } catch { unbilled = null; }
  }
  out.unbilled = unbilled;

  // --- active alerts: utility-related unread notifications (7d)
  let alerts = [];
  try {
    const notes = await prisma.notification.findMany({
      where: {
        ...tf, isRead: false, createdAt: { gte: daysAgo(7) },
        OR: [
          { message: { contains: 'meter', mode: 'insensitive' } },
          { message: { contains: 'utility', mode: 'insensitive' } },
          { message: { contains: 'bijli', mode: 'insensitive' } },
          { message: { contains: 'leak', mode: 'insensitive' } },
          { message: { contains: 'consumption', mode: 'insensitive' } },
          { message: { contains: '[utility', mode: 'insensitive' } },
        ],
      },
      select: { id: true, message: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    alerts = notes.map((n) => ({ id: n.id, message: n.message, createdAt: n.createdAt }));
  } catch { alerts = []; }
  out.activeAlerts = alerts;
  out.activeAlertCount = alerts.length;

  // --- green score: electricity trend se (simple, honest)
  let greenScore = null;
  try {
    const elec = byType30d.find((t) => t.type === 'electricity');
    if (elec && elec.consumption > 0) {
      const curr = elec.consumption;
      const prev = elec.prevConsumption || curr;
      const changePct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
      // Score: kam consumption = zyada score; 50 baseline, ±trend adjust
      const score = Math.max(0, Math.min(100, Math.round(50 - changePct)));
      greenScore = {
        score,
        co2kg30d: Math.round(curr * 0.5 * 100) / 100, // electricity × 0.5 kg CO2/kWh
        trendPct: Math.round(changePct * 100) / 100,
        kwh30d: curr,
        note: changePct < 0 ? 'Bijli ka istemal kam hua — achhi baat!' : 'Bijli ka istemal barha hai',
      };
    }
  } catch { greenScore = null; }
  out.greenScore = greenScore;

  // --- quick counters
  out.activeMeters = meters.length;
  res.json(out);
});

module.exports = router;
