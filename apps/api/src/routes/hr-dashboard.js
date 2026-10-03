// Phase 42 Track 10: HR Dashboard (stats + attrition trend).
// No migration — sirf tracks 1-9 ke models se compute. Merge na hue models guarded: 0/empty.
// Mount: app.use('/api/hr', require('./routes/hr-dashboard')); (coordinator)
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const HR_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const hrOnly = requireRole(...HR_ROLES);

// Merge se pehle model na ho to false (defensive, 503 nahi)
const has = (name) => !!(prisma && prisma[name]);

function dayBoundsUTC() {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// GET /api/hr/stats — headcount, departments, aaj ki attendance, pending items
router.get('/stats', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const out = {
      headcount: { active: 0, onLeave: 0, exited: 0, total: 0 },
      departments: [],
      todayAttendance: { present: 0, late: 0, absent: 0, onLeave: 0, noRecord: 0 },
      pending: { leaves: 0, advances: 0, onboarding: 0, exits: 0 },
      modules: {},
    };

    // Headcount + department breakdown (Employee)
    out.modules.employees = has('employee');
    if (out.modules.employees) {
      const groups = await prisma.employee.groupBy({
        by: ['status'], where: { ...tf }, _count: { _all: true },
      });
      for (const g of groups) {
        if (g.status === 'active') out.headcount.active = g._count._all;
        else if (g.status === 'on_leave') out.headcount.onLeave = g._count._all;
        else if (g.status === 'exited') out.headcount.exited = g._count._all;
      }
      out.headcount.total = out.headcount.active + out.headcount.onLeave;

      const depts = await prisma.employee.groupBy({
        by: ['department'], where: { ...tf, status: { in: ['active', 'on_leave'] } }, _count: { _all: true },
      });
      out.departments = depts.map((g) => ({ department: g.department, count: g._count._all }));
    }

    // Aaj ki attendance (StaffAttendance)
    out.modules.attendance = has('staffAttendance');
    if (out.modules.attendance) {
      const { start, end } = dayBoundsUTC();
      const rows = await prisma.staffAttendance.findMany({
        where: { ...tf, date: { gte: start, lt: end } }, select: { status: true },
      });
      for (const r of rows) {
        if (r.status === 'present') out.todayAttendance.present += 1;
        else if (r.status === 'late') out.todayAttendance.late += 1;
        else if (r.status === 'absent') out.todayAttendance.absent += 1;
        else if (r.status === 'on_leave' || r.status === 'half_day') out.todayAttendance.onLeave += 1;
      }
      // Jin active employees ka aaj koi record nahi — noRecord
      if (out.modules.employees) {
        out.todayAttendance.noRecord = Math.max(
          0, out.headcount.active - (out.todayAttendance.present + out.todayAttendance.late + out.todayAttendance.absent + out.todayAttendance.onLeave)
        );
      }
    }

    // Pending leave requests: purana Leave model (userId-based) prefer karo, warna naya LeaveRequest
    out.modules.leaves = has('leave') || has('leaveRequest');
    try {
      if (has('leave')) {
        out.pending.leaves = await prisma.leave.count({ where: { ...tf, status: 'pending' } });
      } else if (has('leaveRequest')) {
        out.pending.leaves = await prisma.leaveRequest.count({ where: { ...tf, status: 'pending' } });
      }
    } catch { out.pending.leaves = 0; }

    // Pending salary advances (track 6 ka model abhi tree me nahi — guarded)
    out.modules.advances = has('salaryAdvance');
    if (out.modules.advances) {
      out.pending.advances = await prisma.salaryAdvance.count({ where: { ...tf, status: 'pending' } });
    }

    // Onboarding in-progress
    out.modules.onboarding = has('employeeOnboarding');
    if (out.modules.onboarding) {
      out.pending.onboarding = await prisma.employeeOnboarding.count({ where: { ...tf, status: 'in_progress' } });
    }

    // Exits in pipeline (track 8 ka model abhi tree me nahi — guarded)
    out.modules.exits = has('employeeExit');
    if (out.modules.exits) {
      out.pending.exits = await prisma.employeeExit.count({
        where: { ...tf, status: { in: ['initiated', 'clearance_pending'] } },
      });
    }

    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/hr/attrition?months=12 — monthly joins vs exits trend
router.get('/attrition', hrOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    let months = parseInt(req.query.months, 10) || 12;
    months = Math.min(36, Math.max(1, months));

    const series = [];
    const exitsSupported = has('employeeExit');
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const mStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const mEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
      const label = mStart.toLocaleString('en', { month: 'short' }) + ' ' + mStart.getUTCFullYear();

      let joins = 0;
      let exits = 0;
      if (has('employee')) {
        joins = await prisma.employee.count({
          where: { ...tf, joiningDate: { gte: mStart, lt: mEnd } },
        });
      }
      if (exitsSupported) {
        exits = await prisma.employeeExit.count({
          where: { ...tf, status: 'completed', completedAt: { gte: mStart, lt: mEnd } },
        });
      }
      series.push({ month: label, joins, exits });
    }

    res.json({ series, exitsSupported });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
