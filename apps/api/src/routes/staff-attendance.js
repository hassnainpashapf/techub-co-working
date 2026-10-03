// Phase 42 Track 2: Staff Attendance — check-in/out for employees with late detection.
// Late rule: shift start from Phase 34 Shift model (via employee.userId), else 09:00 default, +15 min grace.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const managerOnly = requireRole(...STAFF_ROLES);
const STATUSES = ['present', 'late', 'absent', 'half_day', 'on_leave'];

const correctionSchema = z.object({
  checkIn: z.coerce.date().nullable().optional(),
  checkOut: z.coerce.date().nullable().optional(),
  status: z.enum(STATUSES).optional(),
  note: z.string().max(1000).nullable().optional(),
});

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'StaffAttendance',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

// 503 until the schema fragment is merged by the coordinator.
function migrationGuard(_req, res, next) {
  if (!prisma.staffAttendance) {
    return res.status(503).json({ ok: false, error: 'staff_attendance_unavailable' });
  }
  next();
}

function startOfDayUTC(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function minutesFromHM(hm) {
  const [h, m] = String(hm || '09:00').split(':').map((v) => parseInt(v, 10) || 0);
  return h * 60 + m;
}

// Resolve shift start for an employee's linked user on a date, else 09:00 default.
async function shiftStartMinutes(tenantId, employee, date) {
  try {
    if (employee && employee.userId && prisma.shift) {
      const shift = await prisma.shift.findUnique({
        where: { userId_date: { userId: employee.userId, date: startOfDayUTC(date) } },
        select: { startTime: true },
      });
      if (shift && shift.startTime) return minutesFromHM(shift.startTime);
    }
  } catch { /* non-fatal — fall through to default */ }
  return 9 * 60; // default 09:00
}

function deriveStatus(checkIn, checkOut, shiftStartMin) {
  let status = 'present';
  let lateMinutes = null;
  if (checkIn) {
    const inMin = checkIn.getUTCHours() * 60 + checkIn.getUTCMinutes();
    if (inMin > shiftStartMin + 15) {
      status = 'late';
      lateMinutes = inMin - shiftStartMin;
    }
  }
  let workedMinutes = null;
  if (checkIn && checkOut && checkOut > checkIn) {
    workedMinutes = Math.round((checkOut - checkIn) / 60000);
    if (workedMinutes < 240) status = 'half_day';
  }
  return { status, lateMinutes, workedMinutes };
}

// All routes need auth + tenant user.
router.use(authenticate, requireTenantUser, migrationGuard);

// POST /api/staff-attendance/checkin — apna check-in (logged-in user → linked employee)
router.post('/checkin', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const employee = await prisma.employee.findFirst({
      where: { ...tf, userId: req.user.sub, status: 'active' },
    });
    if (!employee) return res.status(404).json({ ok: false, error: 'no_linked_employee' });

    const today = startOfDayUTC(new Date());
    const now = new Date();
    const shiftStartMin = await shiftStartMinutes(req.user.tenantId, employee, today);
    const { status, lateMinutes } = deriveStatus(now, null, shiftStartMin);

    const existing = await prisma.staffAttendance.findUnique({
      where: { tenantId_employeeId_date: { tenantId: req.user.tenantId, employeeId: employee.id, date: today } },
    });
    if (existing && existing.checkIn) {
      return res.status(409).json({ ok: false, error: 'already_checked_in' });
    }
    const rec = existing
      ? await prisma.staffAttendance.update({
          where: { id: existing.id },
          data: { checkIn: now, status, lateMinutes },
        })
      : await prisma.staffAttendance.create({
          data: {
            tenantId: req.user.tenantId,
            employeeId: employee.id,
            date: today,
            checkIn: now,
            status,
            lateMinutes,
          },
        });
    await audit(req, 'staff_attendance.checkin', rec.id, { employeeId: employee.id, status });
    res.json({ ok: true, attendance: rec });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'checkin_failed' });
  }
});

// POST /api/staff-attendance/checkout — apna check-out
router.post('/checkout', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const employee = await prisma.employee.findFirst({
      where: { ...tf, userId: req.user.sub, status: 'active' },
    });
    if (!employee) return res.status(404).json({ ok: false, error: 'no_linked_employee' });

    const today = startOfDayUTC(new Date());
    const rec = await prisma.staffAttendance.findUnique({
      where: { tenantId_employeeId_date: { tenantId: req.user.tenantId, employeeId: employee.id, date: today } },
    });
    if (!rec || !rec.checkIn) return res.status(409).json({ ok: false, error: 'no_checkin_found' });
    if (rec.checkOut) return res.status(409).json({ ok: false, error: 'already_checked_out' });

    const now = new Date();
    const shiftStartMin = await shiftStartMinutes(req.user.tenantId, employee, today);
    const { status, lateMinutes, workedMinutes } = deriveStatus(rec.checkIn, now, shiftStartMin);
    const updated = await prisma.staffAttendance.update({
      where: { id: rec.id },
      data: { checkOut: now, status, lateMinutes, workedMinutes },
    });
    await audit(req, 'staff_attendance.checkout', updated.id, { employeeId: employee.id, workedMinutes });
    res.json({ ok: true, attendance: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'checkout_failed' });
  }
});

// GET /api/staff-attendance — staff roles: list with filters
router.get('/', managerOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { date, from, to, employeeId } = req.query;
    const where = { ...tf };
    if (employeeId) where.employeeId = employeeId;
    if (date) where.date = startOfDayUTC(date);
    else if (from || to) {
      where.date = {};
      if (from) where.date.gte = startOfDayUTC(from);
      if (to) where.date.lte = startOfDayUTC(to);
    }
    const rows = await prisma.staffAttendance.findMany({
      where,
      include: { employee: { select: { id: true, name: true, department: true, designation: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    res.json({ ok: true, attendance: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'fetch_failed' });
  }
});

// GET /api/staff-attendance/summary — monthly per-employee counts
router.get('/summary', managerOnly, async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const monthStr = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const [y, m] = monthStr.split('-').map((v) => parseInt(v, 10));
    if (!y || !m || m < 1 || m > 12) return res.status(400).json({ ok: false, error: 'invalid_month' });
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));

    const employees = await prisma.employee.findMany({
      where: { ...tf, status: { not: 'exited' } },
      select: { id: true, name: true, department: true },
    });
    const rows = await prisma.staffAttendance.findMany({
      where: { ...tf, date: { gte: start, lt: end } },
    });
    const byEmp = new Map();
    for (const r of rows) {
      if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, []);
      byEmp.get(r.employeeId).push(r);
    }
    // Working days in month (Mon–Fri).
    let workingDays = 0;
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) workingDays++;
    }
    const summary = employees.map((e) => {
      const recs = byEmp.get(e.id) || [];
      const byDate = new Map(recs.map((r) => [r.date.toISOString().slice(0, 10), r]));
      const counts = { present: 0, late: 0, absent: 0, half_day: 0, on_leave: 0 };
      let totalLateMinutes = 0;
      for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) continue; // weekends off
        const r = byDate.get(d.toISOString().slice(0, 10));
        if (!r) {
          counts.absent++;
        } else {
          const s = STATUSES.includes(r.status) ? r.status : 'present';
          counts[s]++;
          if (r.lateMinutes) totalLateMinutes += r.lateMinutes;
        }
      }
      return {
        employeeId: e.id, name: e.name, department: e.department,
        workingDays, ...counts, totalLateMinutes,
      };
    });
    res.json({ ok: true, month: monthStr, workingDays, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'summary_failed' });
  }
});

// PATCH /api/staff-attendance/:id — manual correction
router.patch('/:id', managerOnly, validateBody(correctionSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.staffAttendance.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
    const data = {};
    if (req.body.checkIn !== undefined) data.checkIn = req.body.checkIn;
    if (req.body.checkOut !== undefined) data.checkOut = req.body.checkOut;
    if (req.body.note !== undefined) data.note = req.body.note;
    // Recompute derived fields if times changed and status not explicitly set.
    const checkIn = data.checkIn !== undefined ? data.checkIn : existing.checkIn;
    const checkOut = data.checkOut !== undefined ? data.checkOut : existing.checkOut;
    if (req.body.status) {
      data.status = req.body.status;
      if (req.body.status !== 'late') data.lateMinutes = null;
    } else if (data.checkIn !== undefined || data.checkOut !== undefined) {
      const employee = await prisma.employee.findFirst({ where: { ...tf, id: existing.employeeId } });
      const shiftStartMin = await shiftStartMinutes(req.user.tenantId, employee, existing.date);
      const derived = deriveStatus(checkIn, checkOut, shiftStartMin);
      data.status = derived.status;
      data.lateMinutes = derived.lateMinutes;
      data.workedMinutes = derived.workedMinutes;
    }
    const updated = await prisma.staffAttendance.update({ where: { id: existing.id }, data });
    await audit(req, 'staff_attendance.correct', updated.id, { status: updated.status });
    res.json({ ok: true, attendance: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'update_failed' });
  }
});

module.exports = router;
