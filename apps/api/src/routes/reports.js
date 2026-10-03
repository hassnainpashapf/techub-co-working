const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'manager', 'finance_officer'));

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

// ---------------------------------------------------------------------------
// Phase 25: Advanced analytics (date-range based, grouped)
// ---------------------------------------------------------------------------

function parseRange(req) {
  let from = req.query.from ? new Date(req.query.from) : null;
  let to = req.query.to ? new Date(req.query.to) : null;
  if (!from || Number.isNaN(from.getTime())) from = new Date(Date.now() - 90 * 86400000);
  if (!to || Number.isNaN(to.getTime())) to = new Date();
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function bucketKey(d, groupBy) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (groupBy === 'week') {
    // ISO week number
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  if (groupBy === 'day') return `${y}-${m}-${day}`;
  return `${y}-${m}`;
}

// Revenue: payments grouped by month/week/day + outstanding invoice totals.
router.get('/revenue-detail', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const groupBy = ['month', 'week', 'day'].includes(req.query.groupBy) ? req.query.groupBy : 'month';
    const tf = tenantFilter(req);

    const [payments, openInvoices] = await Promise.all([
      prisma.payment.findMany({
        where: { ...tf, paidAt: { gte: from, lte: to } },
        select: { amount: true, paidAt: true },
      }),
      prisma.invoice.findMany({
        where: { ...tf, status: { in: ['unpaid', 'partial', 'overdue'] } },
        select: { amount: true, amountPaid: true },
      }),
    ]);

    const buckets = {};
    for (const p of payments) {
      const key = bucketKey(new Date(p.paidAt), groupBy);
      buckets[key] = (buckets[key] || 0) + num(p.amount);
    }
    const series = Object.keys(buckets).sort().map((k) => ({ period: k, total: Math.round(buckets[k] * 100) / 100 }));
    const totalCollected = series.reduce((s, r) => s + r.total, 0);
    const outstanding = openInvoices.reduce((s, i) => s + num(i.amount) - num(i.amountPaid), 0);

    return res.json({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      groupBy,
      series,
      totalCollected: Math.round(totalCollected * 100) / 100,
      outstanding: Math.round(outstanding * 100) / 100,
      paymentCount: payments.length,
      openInvoiceCount: openInvoices.length,
    });
  } catch (err) {
    return next(err);
  }
});

// Occupancy detail: per unit type — booked days vs available days in range.
router.get('/occupancy-detail', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const tf = tenantFilter(req);
    const daysInRange = Math.max(1, Math.ceil((to - from) / 86400000));

    const units = await prisma.unit.findMany({
      where: tf,
      select: { id: true, type: true },
    });
    const bookings = await prisma.booking.findMany({
      where: { ...tf, status: 'confirmed', startAt: { lte: to }, endAt: { gte: from } },
      select: { unitId: true, startAt: true, endAt: true },
    });

    // Distinct booked days per unit
    const bookedDays = {};
    for (const b of bookings) {
      const s = new Date(Math.max(new Date(b.startAt).getTime(), from.getTime()));
      const e = new Date(Math.min(new Date(b.endAt).getTime(), to.getTime()));
      const d = new Date(s);
      d.setHours(0, 0, 0, 0);
      const end = new Date(e);
      end.setHours(0, 0, 0, 0);
      while (d <= end) {
        bookedDays[`${b.unitId}:${d.toISOString().slice(0, 10)}`] = true;
        d.setDate(d.getDate() + 1);
      }
    }

    const byType = {};
    for (const u of units) {
      const t = u.type;
      byType[t] = byType[t] || { type: t, totalUnits: 0, bookedDays: 0 };
      byType[t].totalUnits += 1;
    }
    for (const key of Object.keys(bookedDays)) {
      const unitId = key.slice(0, key.lastIndexOf(':'));
      const u = units.find((x) => x.id === unitId);
      if (u) byType[u.type].bookedDays += 1;
    }

    const rows = Object.values(byType).map((r) => {
      const availableDays = r.totalUnits * daysInRange;
      const pct = availableDays ? (r.bookedDays / availableDays) * 100 : 0;
      return { ...r, availableDays, occupancyPct: Math.round(pct * 10) / 10 };
    });

    return res.json({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      daysInRange,
      byType: rows,
    });
  } catch (err) {
    return next(err);
  }
});

// Members: growth per month, active vs inactive, top companies.
router.get('/members', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { from } = parseRange(req);

    const members = await prisma.member.findMany({
      where: tf,
      select: { status: true, createdAt: true, companyName: true, companyId: true },
    });

    let active = 0, inactive = 0;
    const growth = {};
    const companyCounts = {};
    for (const m of members) {
      if (m.status === 'active' || m.status === 'trial') active += 1;
      else inactive += 1;
      if (new Date(m.createdAt) >= from) {
        const d = new Date(m.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        growth[key] = (growth[key] || 0) + 1;
      }
      const cname = m.companyName || null;
      if (cname) companyCounts[cname] = (companyCounts[cname] || 0) + 1;
    }

    const growthSeries = Object.keys(growth).sort().map((k) => ({ month: k, newMembers: growth[k] }));
    const topCompanies = Object.entries(companyCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return res.json({
      total: members.length,
      active,
      inactive,
      growth: growthSeries,
      topCompanies,
    });
  } catch (err) {
    return next(err);
  }
});

// Bookings: per day in range, by status, by unit type, peak hours histogram.
router.get('/bookings', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const tf = tenantFilter(req);

    const bookings = await prisma.booking.findMany({
      where: { ...tf, startAt: { gte: from, lte: to } },
      select: { status: true, startAt: true, unit: { select: { type: true } } },
    });

    const perDay = {};
    const byStatus = {};
    const byUnitType = {};
    const peakHours = {};
    for (const b of bookings) {
      const d = new Date(b.startAt);
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      perDay[dayKey] = (perDay[dayKey] || 0) + 1;
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      const ut = b.unit ? b.unit.type : 'unknown';
      byUnitType[ut] = (byUnitType[ut] || 0) + 1;
      const h = d.getHours();
      peakHours[h] = (peakHours[h] || 0) + 1;
    }

    const perDaySeries = Object.keys(perDay).sort().map((k) => ({ day: k, count: perDay[k] }));
    const peakSeries = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: peakHours[h] || 0 }));

    return res.json({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      total: bookings.length,
      perDay: perDaySeries,
      byStatus,
      byUnitType,
      peakHours: peakSeries,
    });
  } catch (err) {
    return next(err);
  }
});

// CSV export: invoices | payments | members | bookings
const EXPORT_TYPES = ['invoices', 'payments', 'members', 'bookings'];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

router.get('/export', async (req, res, next) => {
  try {
    const type = req.query.type;
    if (!EXPORT_TYPES.includes(type)) {
      return res.status(400).json({ error: { message: `type must be one of: ${EXPORT_TYPES.join(', ')}` } });
    }
    const { from, to } = parseRange(req);
    const tf = tenantFilter(req);

    let headers = [];
    let rows = [];

    if (type === 'invoices') {
      headers = ['Number', 'Member', 'Period Start', 'Period End', 'Due Date', 'Amount', 'Paid', 'Balance', 'Status'];
      const invoices = await prisma.invoice.findMany({
        where: { ...tf, createdAt: { gte: from, lte: to } },
        include: { member: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      rows = invoices.map((i) => [
        i.number,
        i.member ? i.member.name : '',
        new Date(i.periodStart).toISOString().slice(0, 10),
        new Date(i.periodEnd).toISOString().slice(0, 10),
        new Date(i.dueDate).toISOString().slice(0, 10),
        num(i.amount),
        num(i.amountPaid),
        Math.round((num(i.amount) - num(i.amountPaid)) * 100) / 100,
        i.status,
      ]);
    } else if (type === 'payments') {
      headers = ['Receipt No', 'Invoice', 'Member', 'Amount', 'Method', 'Paid At', 'Note'];
      const payments = await prisma.payment.findMany({
        where: { ...tf, paidAt: { gte: from, lte: to } },
        include: { invoice: { select: { number: true, member: { select: { name: true } } } } },
        orderBy: { paidAt: 'desc' },
      });
      rows = payments.map((p) => [
        p.receiptNo || '',
        p.invoice ? p.invoice.number : '',
        p.invoice && p.invoice.member ? p.invoice.member.name : '',
        num(p.amount),
        p.method,
        new Date(p.paidAt).toISOString().slice(0, 16).replace('T', ' '),
        p.note || '',
      ]);
    } else if (type === 'members') {
      headers = ['Name', 'Phone', 'Email', 'Company', 'Status', 'Joined'];
      const members = await prisma.member.findMany({
        where: { ...tf, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
      });
      rows = members.map((m) => [
        m.name,
        m.phone,
        m.email || '',
        m.companyName || '',
        m.status,
        new Date(m.createdAt).toISOString().slice(0, 10),
      ]);
    } else if (type === 'bookings') {
      headers = ['Title', 'Unit', 'Unit Type', 'Member', 'Start', 'End', 'Status'];
      const bookings = await prisma.booking.findMany({
        where: { ...tf, startAt: { gte: from, lte: to } },
        include: { unit: { select: { code: true, type: true } }, member: { select: { name: true } } },
        orderBy: { startAt: 'desc' },
      });
      rows = bookings.map((b) => [
        b.title,
        b.unit ? b.unit.code : '',
        b.unit ? b.unit.type : '',
        b.member ? b.member.name : '',
        new Date(b.startAt).toISOString().slice(0, 16).replace('T', ' '),
        new Date(b.endAt).toISOString().slice(0, 16).replace('T', ' '),
        b.status,
      ]);
    }

    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`);
    return res.send('\uFEFF' + csv);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
