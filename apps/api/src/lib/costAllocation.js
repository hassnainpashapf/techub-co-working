// Phase 51 Track 5: shared utility cost allocation (building-level shared meter bill → members)
// Coordinator: mount /api/cost-allocation → routes/cost-allocation.js
// NOTE: expects Track 3 UtilityBill fragment merged (prisma.utilityBill). Graceful 503 otherwise.
const prisma = require('./prisma');
const { writeAudit } = require('../middleware/audit');

const METHODS = ['equal', 'by_area', 'by_headcount'];

function hasUtilityBill() {
  return !!(prisma && prisma.utilityBill);
}

// Contract overlap with [periodStart, periodEnd]; active statuses only
async function eligibleMembers(tenantId, periodStart, periodEnd) {
  const contracts = await prisma.contract.findMany({
    where: {
      tenantId,
      status: { in: ['active', 'trial'] },
      startDate: { lte: periodEnd },
      OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
    },
    include: { member: { select: { id: true, name: true, email: true, status: true } }, unit: { select: { id: true, code: true, capacity: true } } },
  });
  const seen = new Map();
  for (const c of contracts) {
    if (!c.member || !['active', 'trial'].includes(c.member.status)) continue;
    if (!seen.has(c.member.id)) seen.set(c.member.id, { member: c.member, unit: c.unit, weight: 0 });
  }
  return [...seen.values()];
}

// Weights per method. Unit has no sqft field in schema → by_area falls back to equal (honest flag).
function computeWeights(entries, method) {
  let fellBack = null;
  if (method === 'by_headcount') {
    for (const e of entries) e.weight = Math.max(1, e.unit?.capacity || 1);
  } else if (method === 'by_area') {
    fellBack = 'by_area_needs_sqft';
    for (const e of entries) e.weight = 1;
  } else {
    for (const e of entries) e.weight = 1;
  }
  return fellBack;
}

// Split total into shares (largest remainder so sum === total exactly)
function splitAmount(total, entries) {
  const totalWeight = entries.reduce((s, e) => s + e.weight, 0) || 1;
  const raw = entries.map((e) => (total * e.weight) / totalWeight);
  const floored = raw.map((r) => Math.floor(r * 100) / 100);
  let remainder = Math.round((total - floored.reduce((s, f) => s + f, 0)) * 100);
  const order = raw.map((r, i) => ({ i, frac: r - floored[i] })).sort((a, b) => b.frac - a.frac);
  const shares = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    shares[i] = Math.round((shares[i] + 0.01) * 100) / 100;
    remainder--;
  }
  return shares;
}

async function loadBill(tenantId, utilityBillId) {
  return prisma.utilityBill.findFirst({ where: { id: utilityBillId, tenantId } });
}

async function alreadyAllocated(tenantId, bill) {
  // same meter + same period, member-level rows = already allocated
  const where = { tenantId, memberId: { not: null } };
  if (bill.meterId) where.meterId = bill.meterId;
  if (bill.periodStart) where.periodStart = bill.periodStart;
  if (bill.periodEnd) where.periodEnd = bill.periodEnd;
  const rows = await prisma.utilityBill.findMany({ where, take: 1 });
  return rows.length > 0;
}

// Preview: no DB writes
async function previewAllocation({ tenantId, utilityBillId, method }) {
  if (!hasUtilityBill()) return { ok: false, reason: 'not_migrated' };
  if (!METHODS.includes(method)) return { ok: false, reason: 'invalid_method' };
  const bill = await loadBill(tenantId, utilityBillId);
  if (!bill) return { ok: false, reason: 'bill_not_found' };
  if (bill.memberId) return { ok: false, reason: 'not_shared_bill' };
  const total = Number(bill.amount || 0);
  if (total <= 0) return { ok: false, reason: 'zero_amount' };
  const entries = await eligibleMembers(tenantId, bill.periodStart, bill.periodEnd);
  if (!entries.length) return { ok: false, reason: 'no_eligible_members' };
  const fellBack = computeWeights(entries, method);
  const shares = splitAmount(total, entries);
  return {
    ok: true,
    bill: { id: bill.id, amount: total, periodStart: bill.periodStart, periodEnd: bill.periodEnd },
    method: fellBack ? 'equal' : method,
    methodFellBack: fellBack,
    rows: entries.map((e, i) => ({
      memberId: e.member.id,
      memberName: e.member.name,
      weight: e.weight,
      amount: shares[i],
    })),
  };
}

// Real allocation: creates per-member UtilityBill rows in a transaction
async function allocateSharedBill({ tenantId, utilityBillId, method, actorId }) {
  const preview = await previewAllocation({ tenantId, utilityBillId, method });
  if (!preview.ok) return preview;
  const bill = await loadBill(tenantId, utilityBillId);
  if (await alreadyAllocated(tenantId, bill)) return { ok: false, reason: 'already_allocated' };

  const created = await prisma.$transaction(
    preview.rows.map((r) =>
      prisma.utilityBill.create({
        data: {
          tenantId,
          memberId: r.memberId,
          meterId: bill.meterId || null,
          unitId: bill.unitId || null,
          periodStart: bill.periodStart,
          periodEnd: bill.periodEnd,
          consumption: null,
          amount: r.amount,
          status: 'pending',
        },
      })
    )
  );
  try {
    await prisma.utilityBill.update({ where: { id: bill.id }, data: { status: 'allocated' } });
  } catch { /* status field optional — ignore */ }
  try {
    await writeAudit({ tenantId, actorId: actorId || null, action: 'utility.allocate', entity: 'UtilityBill', entityId: bill.id, newValue: { method: preview.method, rows: created.length, total: preview.bill.amount } });
  } catch { /* never break allocation */ }
  return { ok: true, method: preview.method, methodFellBack: preview.methodFellBack, allocated: created.length, total: preview.bill.amount, rows: created.map((c) => ({ id: c.id, memberId: c.memberId, amount: Number(c.amount) })) };
}

module.exports = { allocateSharedBill, previewAllocation, METHODS };
