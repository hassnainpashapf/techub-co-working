// Phase 51 Track 8/10: Sustainability Score — carbon estimates + green scores.
// Rule-based, real data only. Koi migration nahi (UtilityMeter/MeterReading fragments).
const prisma = require('./prisma');

// CO2 emission factors (kg CO2 per consumption unit)
// electricity: kWh × 0.5 | gas: m³ × 2.0 | water/internet: n/a (no direct CO2)
const CO2_FACTORS = {
  electricity: 0.5,
  gas: 2.0,
  water: 0,
  internet: 0,
};

// Prisma model detect — fragments merge na hon to graceful null
function readingModel() {
  return prisma.meterReading || prisma.utilityMeterReading || null;
}
function meterModel() {
  return prisma.utilityMeter || null;
}
function hasModels() {
  return !!(readingModel() && meterModel());
}

const toNum = (v) => {
  if (v == null) return 0;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Ek meter ki window me consumption (first/last reading ka farq)
async function meterConsumption(tenantId, meterId, from, to) {
  const rm = readingModel();
  const rows = await rm.findMany({
    where: { tenantId, meterId, readAt: { gte: from, lte: to } },
    orderBy: { readAt: 'asc' },
    select: { reading: true, readAt: true },
  });
  if (rows.length < 2) return { consumption: 0, readings: rows.length, insufficient: true };
  const consumption = Math.max(0, toNum(rows[rows.length - 1].reading) - toNum(rows[0].reading));
  return { consumption, readings: rows.length, insufficient: false };
}

// Har active meter par window consumption
async function allConsumption(tenantId, days) {
  if (!hasModels()) return { ok: false, reason: 'not_migrated' };
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const meters = await meterModel().findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, type: true, unitId: true },
  });
  const perMeter = [];
  for (const m of meters) {
    const c = await meterConsumption(tenantId, m.id, from, to);
    perMeter.push({ ...m, ...c });
  }
  return { ok: true, perMeter, from, to };
}

// Carbon estimate (kg CO2) — sirf electricity + gas
async function carbonEstimate(tenantId, days = 30) {
  const data = await allConsumption(tenantId, days);
  if (!data.ok) return data;
  let totalKg = 0;
  const byType = {};
  for (const m of data.perMeter) {
    const factor = CO2_FACTORS[m.type] || 0;
    const kg = m.consumption * factor;
    totalKg += kg;
    byType[m.type] = (byType[m.type] || 0) + kg;
  }
  return { ok: true, totalKg: Math.round(totalKg * 10) / 10, byType, days };
}

// Green score 0-100 (trend-based): pichle 30 din vs us se pichle 30 din
// Kam consumption = zyada score. Data na ho to {score: null}.
async function buildingScore(tenantId) {
  if (!hasModels()) return { ok: false, reason: 'not_migrated' };
  const now = await allConsumption(tenantId, 30);
  if (!now.ok) return now;
  const to = new Date();
  const prevTo = new Date(to.getTime() - 30 * 86400000);
  const prevFrom = new Date(prevTo.getTime() - 30 * 86400000);
  let cur = 0, prev = 0, metersWithData = 0;
  for (const m of now.perMeter) {
    if (m.insufficient) continue;
    metersWithData++;
    cur += m.consumption;
    const p = await meterConsumption(tenantId, m.id, prevFrom, prevTo);
    if (!p.insufficient) prev += p.consumption;
  }
  if (metersWithData === 0) return { ok: true, score: null, reason: 'no_readings' };
  let score;
  let trendPct = null;
  if (prev > 0) {
    trendPct = ((cur - prev) / prev) * 100;
    // -20% ya zyada kami → 100; +20% ya zyada izafa → 40; beech me linear
    score = Math.round(Math.max(0, Math.min(100, 70 - trendPct * 1.5)));
  } else {
    // baseline nahi — sirf data mojoodgi par neutral score
    score = 70;
  }
  return { ok: true, score, trendPct: trendPct == null ? null : Math.round(trendPct * 10) / 10, metersWithData };
}

// Per-unit intensity → member mapping (active contracts ke zariye)
async function memberIntensity(tenantId, days = 30) {
  const data = await allConsumption(tenantId, days);
  if (!data.ok) return data;
  // unitId wale meters ki consumption units par jama karo
  const unitCons = {};
  for (const m of data.perMeter) {
    if (!m.unitId || m.insufficient) continue;
    unitCons[m.unitId] = (unitCons[m.unitId] || 0) + m.consumption;
  }
  const unitIds = Object.keys(unitCons);
  if (unitIds.length === 0) return { ok: true, rows: [] };
  const contracts = await prisma.contract.findMany({
    where: { tenantId, unitId: { in: unitIds }, status: 'active' },
    include: { member: { select: { id: true, name: true } }, unit: { select: { id: true, code: true } } },
  });
  const memberMap = {};
  for (const c of contracts) {
    const key = c.memberId;
    if (!memberMap[key]) memberMap[key] = { memberId: key, memberName: c.member?.name || '—', units: [], consumption: 0 };
    memberMap[key].units.push(c.unit?.code || c.unitId);
    memberMap[key].consumption += unitCons[c.unitId] || 0;
  }
  const rows = Object.values(memberMap)
    .map((r) => ({ ...r, consumption: Math.round(r.consumption * 100) / 100, units: [...new Set(r.units)] }))
    .sort((a, b) => a.consumption - b.consumption);
  return { ok: true, rows, days };
}

// Roman Urdu tips — asal findings se
function buildTips({ score, trendPct, carbon, perMeter }) {
  const tips = [];
  if (score == null) {
    tips.push('Abhi meter readings kaafi nahi hain — rozana readings darj karein taake green score ban sake.');
    return tips;
  }
  if (trendPct != null && trendPct > 10) {
    tips.push(`Bijli/gas ka istemal pichle mahine se ${Math.round(trendPct)}% barha hai — AC timing aur lights check karein.`);
  } else if (trendPct != null && trendPct < -10) {
    tips.push(`Mubarak! Istemal pichle mahine se ${Math.round(Math.abs(trendPct))}% kam hua — yehi raftaar rakhein. 🌱`);
  } else {
    tips.push('Istemaal mustahkam hai. Off-peak hours me heavy equipment chalana mazeed bachat de sakta hai.');
  }
  if (carbon && carbon.totalKg > 500) {
    tips.push(`${Math.round(carbon.totalKg)} kg CO2 (30 din) — LED lights aur inverter AC se carbon footprint ghatayein.`);
  }
  const worst = (perMeter || []).filter((m) => !m.insufficient).sort((a, b) => b.consumption - a.consumption)[0];
  if (worst && worst.consumption > 0) {
    tips.push(`Sab se zyada istemal "${worst.name}" meter par hai — wahan audit karwa lein.`);
  }
  return tips;
}

module.exports = {
  CO2_FACTORS,
  hasModels,
  allConsumption,
  carbonEstimate,
  buildingScore,
  memberIntensity,
  buildTips,
};
