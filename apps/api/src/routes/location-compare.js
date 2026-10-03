// Phase 35 Track 1: Multi-location comparison dashboard.
// Per-building: units, occupancy %, revenue (paid invoices, attributed via
// contract -> unit -> zone -> floor -> building), expenses allocated by unit
// share (Expense has no building FK — allocation is documented), net, members.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

const num = (v) => Number(v) || 0;

function parseRange(req) {
  const { from, to } = req.query;
  const where = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59`);
  }
  return where;
}

// GET /api/location-compare?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const range = parseRange(req);

    const buildings = await prisma.building.findMany({
      where: tf,
      include: {
        floors: {
          include: {
            zones: {
              include: { units: { select: { id: true, status: true, monthlyPrice: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // unitId -> buildingId map
    const unitBuilding = new Map();
    for (const b of buildings) {
      for (const f of b.floors) {
        for (const z of f.zones) {
          for (const u of z.units) unitBuilding.set(u.id, b.id);
        }
      }
    }

    // Active contracts -> building attribution + member counts
    const contracts = await prisma.contract.findMany({
      where: { ...tf, status: 'active' },
      select: { memberId: true, unitId: true },
    });
    const memberBuilding = new Map(); // memberId -> buildingId (first active contract)
    const buildingMembers = new Map(); // buildingId -> Set(memberId)
    for (const c of contracts) {
      const bid = unitBuilding.get(c.unitId);
      if (!bid) continue;
      if (!memberBuilding.has(c.memberId)) memberBuilding.set(c.memberId, bid);
      if (!buildingMembers.has(bid)) buildingMembers.set(bid, new Set());
      buildingMembers.get(bid).add(c.memberId);
    }

    // Revenue: paid invoices in range, attributed via contract -> unit -> building,
    // fallback via member's active-contract building.
    const invoices = await prisma.invoice.findMany({
      where: {
        ...tf,
        ...range,
        invoiceType: 'standard',
        status: { notIn: ['cancelled', 'draft'] },
      },
      select: {
        amountPaid: true,
        memberId: true,
        contract: { select: { unitId: true } },
      },
    });
    const revenueByBuilding = new Map();
    for (const inv of invoices) {
      let bid = null;
      if (inv.contract && inv.contract.unitId) bid = unitBuilding.get(inv.contract.unitId);
      if (!bid) bid = memberBuilding.get(inv.memberId);
      if (!bid) continue;
      revenueByBuilding.set(bid, (revenueByBuilding.get(bid) || 0) + num(inv.amountPaid));
    }

    // Expenses: approved in range; no building FK -> allocate by unit share.
    const expenses = await prisma.expense.findMany({
      where: { ...tf, status: 'approved', date: range.createdAt ? range.createdAt : undefined },
      select: { amount: true },
    });
    const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
    const totalUnits = [...unitBuilding.keys()].length;

    const rows = buildings.map((b) => {
      const units = b.floors.flatMap((f) => f.zones.flatMap((z) => z.units));
      const occupied = units.filter((u) => u.status === 'occupied').length;
      const revenue = revenueByBuilding.get(b.id) || 0;
      const expenseAllocated = totalUnits > 0 ? (totalExpenses * units.length) / totalUnits : 0;
      return {
        buildingId: b.id,
        name: b.name,
        city: b.city || null,
        address: b.address || null,
        units: units.length,
        occupied,
        occupancyPct: units.length > 0 ? Math.round((occupied / units.length) * 100) : 0,
        activeMembers: buildingMembers.has(b.id) ? buildingMembers.get(b.id).size : 0,
        revenue: Math.round(revenue * 100) / 100,
        expensesAllocated: Math.round(expenseAllocated * 100) / 100,
        net: Math.round((revenue - expenseAllocated) * 100) / 100,
      };
    });

    const ranked = [...rows].sort((a, b) => b.net - a.net).map((r, i) => ({ ...r, rank: i + 1 }));
    const totals = {
      buildings: rows.length,
      units: rows.reduce((s, r) => s + r.units, 0),
      occupied: rows.reduce((s, r) => s + r.occupied, 0),
      activeMembers: rows.reduce((s, r) => s + r.activeMembers, 0),
      revenue: Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
      expenses: Math.round(totalExpenses * 100) / 100,
      net: Math.round(rows.reduce((s, r) => s + r.net, 0) * 100) / 100,
    };
    totals.occupancyPct = totals.units > 0 ? Math.round((totals.occupied / totals.units) * 100) : 0;

    res.json({
      range: { from: req.query.from || null, to: req.query.to || null },
      note: 'Expenses have no building link in the data model; they are allocated to buildings by unit share.',
      buildings: ranked,
      totals,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
