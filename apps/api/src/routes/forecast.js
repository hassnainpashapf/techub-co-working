// Phase 35 Track 3/10: Occupancy Forecasting — simple, honest math.
// History: monthly occupancy from contracts overlapping each month.
// Forecast: linear-regression trend, adjusted for known contract expiries
// (churn, using a data-driven renewal rate) and the pending booking-request
// pipeline (approval-rate weighted). No ML, no overclaiming.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(d) {
  return d.toLocaleString('en', { month: 'short', year: '2-digit' });
}
function monthStartOf(offset) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}
function monthEndOf(offset) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
}

// Least-squares slope/intercept over y values at x = 0..n-1.
function linearFit(y) {
  const n = y.length;
  if (n < 2) return { slope: 0, intercept: y[0] || 0 };
  const sx = ((n - 1) * n) / 2;
  const sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  let sy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sy += y[i];
    sxy += i * y[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Distinct unitIds with contracts overlapping [from, to].
async function occupiedUnits(tf, from, to) {
  const rows = await prisma.contract.findMany({
    where: {
      ...tf,
      status: 'active',
      startDate: { lte: to },
      OR: [{ endDate: null }, { endDate: { gte: from } }],
    },
    select: { unitId: true },
  });
  return new Set(rows.map((r) => r.unitId)).size;
}

router.get('/occupancy', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 3), 12);

    const totalUnits = await prisma.unit.count({ where: tf });

    // ---- History: past `months` months, oldest first ----
    const history = [];
    for (let i = months; i >= 1; i--) {
      const from = monthStartOf(-i);
      const to = monthEndOf(-i);
      const occupied = totalUnits ? await occupiedUnits(tf, from, to) : 0;
      const rate = totalUnits ? occupied / totalUnits : 0;
      history.push({ month: monthKey(from), label: monthLabel(from), occupied, total: totalUnits, rate: +rate.toFixed(4) });
    }

    // ---- Trend (linear fit on history rates) ----
    const rates = history.map((h) => h.rate);
    const { slope, intercept } = linearFit(rates);
    const trendPerMonth = slope; // occupancy points per month

    // ---- Renewal rate from data: contracts that ended in the past 6 months ----
    const sixAgo = monthStartOf(-6);
    const now = new Date();
    const ended = await prisma.contract.findMany({
      where: {
        ...tf,
        status: { in: ['expired', 'cancelled'] },
        endDate: { gte: sixAgo, lte: now },
      },
      select: { memberId: true, endDate: true },
    });
    let renewalRate = 0.5; // honest default when there is no data
    if (ended.length > 0) {
      const renewed = await prisma.contract.count({
        where: {
          ...tf,
          status: 'active',
          memberId: { in: ended.map((e) => e.memberId) },
          startDate: { gte: sixAgo },
        },
      });
      renewalRate = ended.length ? renewed / ended.length : 0.5;
    }

    // ---- Booking-request pipeline: approval rate + pending demand ----
    const pastReqs = await prisma.bookingRequest.findMany({
      where: { ...tf, createdAt: { gte: sixAgo }, status: { in: ['approved', 'rejected'] } },
      select: { status: true },
    });
    const approved = pastReqs.filter((r) => r.status === 'approved').length;
    const approvalRate = pastReqs.length ? approved / pastReqs.length : 0.25;
    const pendingReqs = await prisma.bookingRequest.findMany({
      where: { ...tf, status: 'pending' },
      select: { startTime: true, endTime: true },
    });
    const hrs = (t) => {
      const [h, m] = String(t || '0:0').split(':').map(Number);
      return (h || 0) + (m || 0) / 60;
    };
    const pendingUnitMonths = pendingReqs.reduce((s, r) => {
      const d = Math.max(0, hrs(r.endTime) - hrs(r.startTime));
      return s + d / (30 * 24);
    }, 0);
    const pipelineUnits = pendingUnitMonths * approvalRate; // equivalent occupied units

    // ---- Forecast ----
    const forecast = [];
    for (let i = 1; i <= months; i++) {
      const from = monthStartOf(i);
      const to = monthEndOf(i);
      // Known expiries in this future month (active contracts ending inside it).
      const expiring = await prisma.contract.count({
        where: { ...tf, status: 'active', endDate: { gte: from, lte: to } },
      });
      const expectedChurn = expiring * (1 - renewalRate);
      // Base: linear extrapolation from history.
      const baseUnits = totalUnits * (intercept + slope * (rates.length - 1 + i));
      const fUnits = Math.max(0, baseUnits - expectedChurn + pipelineUnits);
      const rate = totalUnits ? clamp01(fUnits / totalUnits) : 0;
      forecast.push({
        month: monthKey(from),
        label: monthLabel(from),
        occupied: +fUnits.toFixed(1),
        total: totalUnits,
        rate: +rate.toFixed(4),
        expiring,
        expectedChurn: +expectedChurn.toFixed(1),
      });
    }

    const lastRate = rates.length ? rates[rates.length - 1] : 0;
    const futureRate = forecast.length ? forecast[forecast.length - 1].rate : lastRate;
    const trend = trendPerMonth > 0.01 ? 'growing' : trendPerMonth < -0.01 ? 'declining' : 'stable';

    return res.json({
      history,
      forecast,
      trend,
      trendPerMonth: +trendPerMonth.toFixed(4),
      assumptions: {
        model: 'Linear trend on monthly contract occupancy, adjusted for known expiries and the booking-request pipeline. Not ML.',
        renewalRate: +renewalRate.toFixed(2),
        renewalRateSource: ended.length ? `${ended.length} ended contracts (past 6 months)` : 'default (no ended contracts in data)',
        approvalRate: +approvalRate.toFixed(2),
        pendingRequests: pendingReqs.length,
        churnFormula: 'expiring contracts × (1 − renewal rate)',
        pipelineFormula: 'pending requests × approval rate × avg duration (unit-months)',
        currentOccupancy: +lastRate.toFixed(4),
        forecastOccupancy: +futureRate.toFixed(4),
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
