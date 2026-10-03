// Phase 34 Track 1: Staff Shift Scheduling.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);
const STAFF_USER_ROLES = ['ceo', 'admin', 'operations_manager', 'manager', 'finance_officer', 'receptionist', 'office_boy'];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function mondayOf(week) {
  // Normalize ?week= to the Monday of that week (UTC).
  const d = week ? new Date(`${week}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay(); // 0 = Sun
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dayStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const shiftSchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(TIME_RE, 'startTime must be HH:MM'),
  endTime: z.string().regex(TIME_RE, 'endTime must be HH:MM'),
  role: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
}).refine((d) => d.startTime < d.endTime, { message: 'endTime must be after startTime' });

const templateSchema = z.object({
  userId: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  role: z.string().max(100).optional().nullable(),
}).refine((d) => d.startTime < d.endTime, { message: 'endTime must be after startTime' });

function audit(req, action, entity, entityId, newValue) {
  const tf = tenantFilter(req);
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity, entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

async function staffUsers(tf) {
  return prisma.user.findMany({
    where: { ...tf, role: { in: STAFF_USER_ROLES }, isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
}

// GET /api/shifts/staff — active staff users for the assign dropdown
router.get('/staff', staffOnly, async (req, res, next) => {
  try {
    return res.json({ staff: await staffUsers(tenantFilter(req)) });
  } catch (err) { return next(err); }
});

// GET /api/shifts/my — my upcoming shifts (any logged-in staff member)
router.get('/my', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const shifts = await prisma.shift.findMany({
      where: { userId: req.user.sub, date: { gte: today }, ...tf },
      orderBy: { date: 'asc' },
      take: 30,
    });
    return res.json({ shifts });
  } catch (err) { return next(err); }
});

// GET /api/shifts/?week=YYYY-MM-DD — weekly grid data
router.get('/', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const monday = mondayOf(req.query.week);
    if (!monday) return res.status(400).json({ error: { message: 'Invalid ?week= date (YYYY-MM-DD).' } });
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setUTCDate(d.getUTCDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
    const [shifts, staff] = await Promise.all([
      prisma.shift.findMany({
        where: { ...tf, date: { gte: monday, lte: sunday } },
        include: { user: { select: { id: true, name: true, role: true } } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      }),
      staffUsers(tf),
    ]);
    return res.json({ weekStart: days[0], days, shifts, staff });
  } catch (err) { return next(err); }
});

// POST /api/shifts/ — assign a single shift
router.post('/', staffOnly, validateBody(shiftSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const user = await prisma.user.findFirst({
      where: { id: req.body.userId, ...tf, isActive: true },
    });
    if (!user) return res.status(404).json({ error: { message: 'Staff user not found.' } });
    const date = dayStart(req.body.date);
    const shift = await prisma.shift.create({
      data: {
        tenantId: tf.tenantId,
        userId: user.id,
        date,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        role: req.body.role || null,
        notes: req.body.notes || null,
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    audit(req, 'shift.create', 'Shift', shift.id, { userId: user.id, date: req.body.date });
    return res.status(201).json({ shift });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: { message: 'This user already has a shift on that date.' } });
    }
    return next(err);
  }
});

// POST /api/shifts/generate — auto-generate a week's shifts from templates
router.post('/generate', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const monday = mondayOf(req.body.weekStart);
    if (!monday) return res.status(400).json({ error: { message: 'weekStart (YYYY-MM-DD) is required.' } });
    const templates = await prisma.shiftTemplate.findMany({
      where: { ...tf },
      include: { user: { select: { isActive: true } } },
    });
    let created = 0; let skipped = 0;
    for (const t of templates) {
      if (!t.user?.isActive) { skipped++; continue; }
      // dayOfWeek 0=Sun..6=Sat; monday-based offset: Sun -> +6, Mon -> +0
      const offset = (t.dayOfWeek + 6) % 7;
      const date = new Date(monday); date.setUTCDate(date.getUTCDate() + offset);
      try {
        await prisma.shift.create({
          data: {
            tenantId: tf.tenantId, userId: t.userId, date,
            startTime: t.startTime, endTime: t.endTime, role: t.role,
          },
        });
        created++;
      } catch (err) {
        if (err.code === 'P2002') skipped++; // already has a shift that day
        else throw err;
      }
    }
    audit(req, 'shift.generate', 'Shift', null, { weekStart: monday.toISOString().slice(0, 10), created, skipped });
    return res.json({ created, skipped });
  } catch (err) { return next(err); }
});

// DELETE /api/shifts/:id — remove a shift
router.delete('/:id', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const shift = await prisma.shift.findFirst({ where: { id: req.params.id, ...tf } });
    if (!shift) return res.status(404).json({ error: { message: 'Shift not found.' } });
    await prisma.shift.delete({ where: { id: shift.id } });
    audit(req, 'shift.delete', 'Shift', shift.id, null);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// GET /api/shifts/templates — weekly recurring templates
router.get('/templates', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const templates = await prisma.shiftTemplate.findMany({
      where: tf,
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return res.json({ templates });
  } catch (err) { return next(err); }
});

// POST /api/shifts/templates — save a template
router.post('/templates', staffOnly, validateBody(templateSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const user = await prisma.user.findFirst({
      where: { id: req.body.userId, ...tf, isActive: true },
    });
    if (!user) return res.status(404).json({ error: { message: 'Staff user not found.' } });
    const tpl = await prisma.shiftTemplate.upsert({
      where: { tenantId_userId_dayOfWeek: { tenantId: tf.tenantId, userId: user.id, dayOfWeek: req.body.dayOfWeek } },
      update: { startTime: req.body.startTime, endTime: req.body.endTime, role: req.body.role || null },
      create: {
        tenantId: tf.tenantId, userId: user.id, dayOfWeek: req.body.dayOfWeek,
        startTime: req.body.startTime, endTime: req.body.endTime, role: req.body.role || null,
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    audit(req, 'shift.template.save', 'ShiftTemplate', tpl.id, { userId: user.id, dayOfWeek: req.body.dayOfWeek });
    return res.status(201).json({ template: tpl });
  } catch (err) { return next(err); }
});

// DELETE /api/shifts/templates/:id — remove a template
router.delete('/templates/:id', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tpl = await prisma.shiftTemplate.findFirst({ where: { id: req.params.id, ...tf } });
    if (!tpl) return res.status(404).json({ error: { message: 'Template not found.' } });
    await prisma.shiftTemplate.delete({ where: { id: tpl.id } });
    audit(req, 'shift.template.delete', 'ShiftTemplate', tpl.id, null);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

module.exports = router;
