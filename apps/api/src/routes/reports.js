const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'finance_officer'));

const num = (v) => Number(v);

function monthBounds(year, month) {
  // month: 1-12. Returns [first-of-month, first-of-next-month).
  return [new Date(year, month - 1, 1), new Date(year, month, 1)];
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Occupancy now (per floor) + a 6-month trend.
// Historical rate: active contracts overlapping the month-end ÷ bookable units
// (non-meeting rooms). Contracts are the source of truth for who held a unit.
router.get('/occupancy', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);

    const units = await prisma.unit.findMany({
      where: { ...tf, type: { not: 'meeting_room' } },
      select: { id: true, status: true, zone: { select: { floorId: true } } },
    });
    const floors = await prisma.floor.findMany({
      where: tf,
      select: { id: true, name: true },
    });
    const floorName = Object.fromEntries(floors.map((f) => [f.id, f.name]));

    const perFloor = {};
    for (const u of units) {
      const fid = u.zone.floorId;
      perFloor[fid] = perFloor[fid] || { floorId: fid, name: floorName[fid], total: 0, occupied: 0 };
      perFloor[fid].total += 1;
      if (u.status === 'occupied') perFloor[fid].occupied += 1;
    }
    const current = Object.values(perFloor).map((f) => ({
      ...f,
      rate: f.total ? f.occupied / f.total : 0,
    }));
    const totalUnits = units.length;

    // 6-month trend: for each month, count active contracts whose interval
    // covers the month's last day (startDate <= monthEnd AND (no endDate OR
    // endDate >= monthStart)).
    const trend = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const [start, end] = monthBounds(year, month);
      const monthEnd = new Date(end.getTime() - 1);
      const occupied = await prisma.contract.count({
        where: {
          ...tf,
          status: { in: ['active', 'expired'] },
          startDate: { lte: monthEnd },
          OR: [{ endDate: null }, { endDate: { gte: start } }],
        },
      });
      trend.push({
        month: monthKey(year, month),
        total: totalUnits,
        occupied: Math.min(occupied, totalUnits),
        rate: totalUnits ? Math.min(occupied, totalUnits) / totalUnits : 0,
      });
    }

    return res.json({ current, trend });
  } catch (err) {
    return next(err);
  }
});

// Revenue report: 12 months of income (payments), expenses, net.
router.get('/revenue', async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const tf = tenantFilter(req);

    const [payments, expenses] = await Promise.all([
      prisma.payment.findMany({
        where: {
          ...tf,
          paidAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
        },
        select: { amount: true, paidAt: true },
      }),
      prisma.expense.findMany({
        where: {
          ...tf,
          date: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
        },
        select: { amount: true, date: true },
      }),
    ]);

    const months = [];
    for (let m = 1; m <= 12; m++) {
      months.push({ month: monthKey(year, m), income: 0, expenses: 0, net: 0 });
    }
    for (const p of payments) {
      const idx = p.paidAt.getMonth();
      months[idx].income += num(p.amount);
    }
    for (const e of expenses) {
      const idx = e.date.getMonth();
      months[idx].expenses += num(e.amount);
    }
    for (const mo of months) mo.net = mo.income - mo.expenses;

    return res.json({ year, months });
  } catch (err) {
    return next(err);
  }
});

// Dues aging: open invoices bucketed by days overdue.
router.get('/dues-aging', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const invoices = await prisma.invoice.findMany({
      where: { ...tf, status: { in: ['unpaid', 'partial', 'overdue'] } },
      select: { amount: true, amountPaid: true, dueDate: true },
    });

    const buckets = {
      '0-7': { count: 0, total: 0 },
      '8-15': { count: 0, total: 0 },
      '16-30': { count: 0, total: 0 },
      '30+': { count: 0, total: 0 },
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const inv of invoices) {
      const due = new Date(inv.dueDate);
      due.setHours(0, 0, 0, 0);
      const days = Math.max(0, Math.floor((today - due) / (1000 * 60 * 60 * 24)));
      const key = days <= 7 ? '0-7' : days <= 15 ? '8-15' : days <= 30 ? '16-30' : '30+';
      const remaining = num(inv.amount) - num(inv.amountPaid);
      buckets[key].count += 1;
      buckets[key].total += remaining;
    }

    return res.json({ buckets });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
