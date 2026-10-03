// Phase 51 Track 4: Consumption Analytics — utility consumption analytics.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/utility-analytics', require('./routes/utility-analytics'));
// Koi migration nahi — Track 1 (UtilityMeter) / Track 2 (MeterReading) ke fragments
// merge hote hi live; us se pehle graceful empty (koi 500 nahi).
// Assumed shapes (tracks 1/2 ke briefs se):
//   UtilityMeter: id, tenantId, name, type (electricity/water/gas/internet), unitId?, isActive
//   MeterReading: id, tenantId, meterId, reading (Decimal), readAt, createdAt
//   UtilityRate: tenantId, type, ratePerUnit, effectiveFrom
// Frontend integration notes (coordinator):
//   - Utilities dashboard: GET /api/utility-analytics/overview se byType bars (SVG),
//     12-month trend curve, top-units table, cost cards.
//   - Meter detail: GET /api/utility-analytics/meter/:id se monthly SVG bars.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);
const STAFF = ['manager', 'admin', 'ceo', 'super_admin'];
router.use(requireRole(...STAFF));

const hasModel = (name) => Boolean(prisma && prisma[name]);

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthStart(offset) {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - offset);
  return d;
}

// Meter readings se per-meter consumption (window me: last - first reading).
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

// ---------------------------------------------------------------- GET /overview
// 30d consumption by type + 12m trend + cost + top consuming units.
router.get('/overview', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!hasModel('utilityMeter') || !hasModel('meterReading')) {
      return res.json({
        byType30d: [], trend12m: [], cost30d: null,
        topUnits: [], pendingMigration: true,
        note: 'UtilityMeter/MeterReading models abhi merge nahi hue',
      });
    }

    const meters = await prisma.utilityMeter.findMany({
      where: { ...tf, isActive: true },
      select: { id: true, name: true, type: true, unitId: true },
    });
    if (!meters.length) {
      return res.json({ byType30d: [], trend12m: [], cost30d: null, topUnits: [], pendingMigration: false });
    }
    const meterIds = meters.map((m) => m.id);
    const typeOf = Object.fromEntries(meters.map((m) => [m.id, m.type]));
    const nameOf = Object.fromEntries(meters.map((m) => [m.id, m.name]));

    // 30-day consumption by type.
    const cons30 = await consumptionInWindow(tf, meterIds, daysAgo(30));
    const byType = {};
    for (const [id, c] of Object.entries(cons30)) {
      const t = typeOf[id] || 'other';
      byType[t] = (byType[t] || 0) + c;
    }

    // 12-month trend: har mahine ki consumption by type.
    const trend = [];
    for (let m = 11; m >= 0; m--) {
      const start = monthStart(m);
      const end = m === 0 ? new Date() : monthStart(m - 1);
      const readings = await prisma.meterReading.findMany({
        where: { ...tf, meterId: { in: meterIds }, readAt: { gte: start, lt: end } },
        select: { meterId: true, reading: true, readAt: true },
        orderBy: [{ meterId: 'asc' }, { readAt: 'asc' }],
      });
      const agg = {};
      const seen = {};
      for (const r of readings) {
        const v = Number(r.reading);
        if (Number.isNaN(v)) continue;
        if (!seen[r.meterId]) seen[r.meterId] = { first: v, last: v };
        else seen[r.meterId].last = v;
      }
      for (const [id, v] of Object.entries(seen)) {
        const c = v.last - v.first;
        if (c <= 0) continue;
        const t = typeOf[id] || 'other';
        agg[t] = (agg[t] || 0) + c;
      }
      trend.push({ month: monthKey(start), ...agg });
    }

    // Cost: latest rate per type × 30d consumption (rates merge na hon to null).
    let cost30d = null;
    if (hasModel('utilityRate')) {
      const rates = await prisma.utilityRate.findMany({
        where: tf,
        orderBy: { effectiveFrom: 'desc' },
        select: { type: true, ratePerUnit: true, effectiveFrom: true },
      });
      const latest = {};
      for (const r of rates) if (!latest[r.type]) latest[r.type] = Number(r.ratePerUnit);
      let total = 0;
      const byTypeCost = {};
      for (const [t, c] of Object.entries(byType)) {
        const cost = c * (latest[t] || 0);
        byTypeCost[t] = Math.round(cost * 100) / 100;
        total += cost;
      }
      cost30d = { total: Math.round(total * 100) / 100, byType: byTypeCost };
    }

    // Top consuming units (30d) — unit names resolve karne ki koshish.
    let unitNames = {};
    const unitIds = [...new Set(meters.map((m) => m.unitId).filter(Boolean))];
    if (unitIds.length && hasModel('unit')) {
      const units = await prisma.unit.findMany({
        where: { ...tf, id: { in: unitIds } },
        select: { id: true, name: true, unitNumber: true },
      });
      unitNames = Object.fromEntries(units.map((u) => [u.id, u.name || u.unitNumber || u.id]));
    }
    const topUnits = meters
      .map((m) => ({
        meterId: m.id,
        meterName: m.name,
        type: m.type,
        unit: m.unitId ? unitNames[m.unitId] || m.unitId : null,
        consumption30d: Math.round((cons30[m.id] || 0) * 100) / 100,
      }))
      .filter((x) => x.consumption30d > 0)
      .sort((a, b) => b.consumption30d - a.consumption30d)
      .slice(0, 5);

    res.json({
      byType30d: Object.entries(byType).map(([type, consumption]) => ({
        type,
        consumption: Math.round(consumption * 100) / 100,
      })),
      trend12m: trend,
      cost30d,
      topUnits,
      pendingMigration: false,
    });
  } catch (err) {
    console.error('utility-analytics/overview failed:', err.message);
    res.status(500).json({ error: 'Analytics load nahi ho saka' });
  }
});

// ---------------------------------------------------------------- GET /meter/:id
// Ek meter ki 12-month history curve + latest reading.
router.get('/meter/:id', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!hasModel('utilityMeter') || !hasModel('meterReading')) {
      return res.json({ meter: null, history: [], pendingMigration: true });
    }
    const meter = await prisma.utilityMeter.findFirst({
      where: { ...tf, id: req.params.id },
      select: { id: true, name: true, type: true, unitId: true, isActive: true },
    });
    if (!meter) return res.status(404).json({ error: 'Meter nahi mila' });

    const history = [];
    for (let m = 11; m >= 0; m--) {
      const start = monthStart(m);
      const end = m === 0 ? new Date() : monthStart(m - 1);
      const readings = await prisma.meterReading.findMany({
        where: { ...tf, meterId: meter.id, readAt: { gte: start, lt: end } },
        select: { reading: true, readAt: true },
        orderBy: { readAt: 'asc' },
      });
      let consumption = 0;
      if (readings.length >= 2) {
        const first = Number(readings[0].reading);
        const last = Number(readings[readings.length - 1].reading);
        if (!Number.isNaN(first) && !Number.isNaN(last) && last > first) consumption = last - first;
      }
      history.push({ month: monthKey(start), consumption: Math.round(consumption * 100) / 100 });
    }

    const latest = await prisma.meterReading.findFirst({
      where: { ...tf, meterId: meter.id },
      orderBy: { readAt: 'desc' },
      select: { reading: true, readAt: true },
    });

    res.json({
      meter,
      history,
      latestReading: latest ? { reading: Number(latest.reading), readAt: latest.readAt } : null,
      pendingMigration: false,
    });
  } catch (err) {
    console.error('utility-analytics/meter failed:', err.message);
    res.status(500).json({ error: 'Meter history load nahi ho saka' });
  }
});

module.exports = router;
