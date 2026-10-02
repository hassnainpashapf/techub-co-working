const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { tenantFilter, refreshOverdue } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate);

const OPEN_INVOICE_STATUSES = ['unpaid', 'partial', 'overdue'];

// Adds an amountPaid-aware remaining figure on top of a Decimal sum.
const num = (v) => Number(v);

router.get('/stats', async (req, res, next) => {
  try {
    const me = req.user;

    // The member portal gets a personal snapshot, not the business overview.
    if (me.role === 'member') {
      return res.json(await memberDashboard(me));
    }

    const tf = tenantFilter(req);
    await refreshOverdue(prisma, me.tenantId);

    // Occupancy over bookable units (meeting rooms excluded).
    const units = await prisma.unit.findMany({
      where: { ...tf, type: { not: 'meeting_room' } },
      select: { status: true },
    });
    const occupied = units.filter((u) => u.status === 'occupied').length;
    const totalUnits = units.length;

    // Open dues: what is owed right now.
    const openInvoices = await prisma.invoice.findMany({
      where: { ...tf, status: { in: OPEN_INVOICE_STATUSES } },
      select: { amount: true, amountPaid: true },
    });
    const duesTotal = openInvoices.reduce(
      (sum, inv) => sum + num(inv.amount) - num(inv.amountPaid),
      0
    );

    // Revenue this month: cash actually collected (payments), not billed.
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);
    const monthPayments = await prisma.payment.aggregate({
      where: { ...tf, paidAt: { gte: firstOfMonth } },
      _sum: { amount: true },
    });

    // Tasks pending: office_boy only ever sees their own assignments.
    const tasksWhere = { ...tf, status: { not: 'done' } };
    if (me.role === 'office_boy') tasksWhere.assigneeId = me.sub;
    const tasksPending = await prisma.task.count({ where: tasksWhere });

    const membersActive = await prisma.member.count({
      where: { ...tf, status: 'active' },
    });
    const contractsActive = await prisma.contract.count({
      where: { ...tf, status: 'active' },
    });

    // Contracts ending in the next 30 days.
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);
    const expiringContracts = await prisma.contract.findMany({
      where: { ...tf, status: 'active', endDate: { lte: in30Days } },
      include: { member: { select: { id: true, name: true } } },
      orderBy: { endDate: 'asc' },
      take: 5,
    });

    const recentInvoices = await prisma.invoice.findMany({
      where: tf,
      include: { member: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const myTasks = await prisma.task.findMany({
      where: { ...tf, assigneeId: me.sub },
      orderBy: { dueDate: 'asc' },
      take: 5,
    });

    return res.json({
      occupancy: {
        total: totalUnits,
        occupied,
        rate: totalUnits ? occupied / totalUnits : 0,
      },
      dues: { count: openInvoices.length, total: duesTotal },
      revenueThisMonth: num(monthPayments._sum.amount || 0),
      tasksPending,
      membersActive,
      contractsActive,
      expiringContracts: {
        count: expiringContracts.length,
        list: expiringContracts,
      },
      recentInvoices,
      myTasks,
    });
  } catch (err) {
    return next(err);
  }
});

// Personal dashboard for the member portal role.
async function memberDashboard(me) {
  if (!me.memberId) {
    return { myDues: 0, myInvoices: [], myBookings: [], myContract: null };
  }
  const tf = { tenantId: me.tenantId };
  const mine = { memberId: me.memberId };
  const openInvoices = await prisma.invoice.findMany({
    where: { ...tf, ...mine, status: { in: OPEN_INVOICE_STATUSES } },
    orderBy: { dueDate: 'asc' },
  });
  const myDues = openInvoices.reduce(
    (sum, inv) => sum + num(inv.amount) - num(inv.amountPaid),
    0
  );
  const upcoming = await prisma.booking.findMany({
    where: { ...tf, ...mine, startAt: { gte: new Date() }, status: 'confirmed' },
    include: { unit: { select: { id: true, code: true } } },
    orderBy: { startAt: 'asc' },
    take: 5,
  });
  const myContract = await prisma.contract.findFirst({
    where: { ...tf, ...mine, status: 'active' },
    include: { unit: { select: { id: true, code: true, type: true } } },
  });
  return { myDues, myInvoices: openInvoices, myBookings: upcoming, myContract };
}

module.exports = router;
