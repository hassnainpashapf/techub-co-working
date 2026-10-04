// Phase 53 Track 6/10: Live Workshop Sessions — schedule, book, cancel, my bookings.
// Coordinator ke liye:
//   Mount: app.use('/api/workshops', require('./routes/workshops'));
//   Sidebar: { label: 'Workshops', path: '/academy/workshops' } — roles: staff + member
// Member endpoints (role 'member' ya staff):
//   GET /api/workshops/upcoming — upcoming scheduled workshops (seatsLeft samet)
//   GET /api/workshops/my — meri bookings
//   POST /api/workshops/:id/book — seat book karo
//   POST /api/workshops/:id/cancel — booking cancel karo
// Staff endpoints (ceo/admin/super_admin/manager):
//   POST /api/workshops — create | GET /api/workshops — list (sab)
//   PUT /api/workshops/:id | DELETE /api/workshops/:id
//   GET /api/workshops/:id/bookings — attendee list
//   PATCH /api/workshops/:id/bookings/:bookingId/attend — attended mark karo
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

function W(res) {
  if (!prisma.workshop) {
    res.status(503).json({ error: 'Academy module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.workshop;
}
function WB(res) {
  if (!prisma.workshopBooking) {
    res.status(503).json({ error: 'Academy module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.workshopBooking;
}

const workshopSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  courseId: z.string().max(64).optional().nullable(),
  instructorId: z.string().max(64).optional().nullable(),
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().min(1)),
  durationMin: z.number().int().min(5).max(1440).optional().default(60),
  meetingUrl: z.string().max(2000).optional().nullable(),
  capacity: z.number().int().min(1).max(10000).optional().nullable(),
  status: z.enum(['scheduled', 'ongoing', 'completed', 'cancelled']).optional().default('scheduled'),
});

const withCounts = (w) => {
  const active = (w.bookings || []).filter((b) => b.status !== 'cancelled').length;
  return { ...w, bookings: undefined, bookedSeats: active, seatsLeft: w.capacity == null ? null : Math.max(0, w.capacity - active) };
};

router.use(authenticate, requireTenantUser);

// ---------- Member endpoints ----------
router.get('/upcoming', async (req, res, next) => {
  try {
    const M = W(res); if (!M) return;
    const tf = tenantFilter(req);
    const workshops = await M.findMany({
      where: { ...tf, status: { in: ['scheduled', 'ongoing'] }, scheduledAt: { gte: new Date(Date.now() - 3 * 3600 * 1000) } },
      orderBy: { scheduledAt: 'asc' },
      include: { bookings: { where: { status: { not: 'cancelled' } }, select: { memberId: true } } },
    });
    const memberId = req.user.memberId || null;
    const list = workshops.map((w) => ({
      ...withCounts(w),
      myBooking: memberId ? w.bookings.some((b) => b.memberId === memberId) : false,
    }));
    res.json({ workshops: list });
  } catch (e) { next(e); }
});

router.get('/my', async (req, res, next) => {
  try {
    const B = WB(res); if (!B) return;
    const memberId = req.user.memberId;
    if (!memberId) return res.status(403).json({ error: 'Member account required.' });
    const tf = tenantFilter(req);
    const bookings = await B.findMany({
      where: { ...tf, memberId, status: { not: 'cancelled' } },
      include: { workshop: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ bookings });
  } catch (e) { next(e); }
});

router.post('/:id/book', async (req, res, next) => {
  try {
    const M = W(res); if (!M) return;
    const B = WB(res); if (!B) return;
    const memberId = req.user.memberId;
    if (!memberId) return res.status(403).json({ error: 'Member account required.' });
    const tf = tenantFilter(req);
    const workshop = await M.findFirst({
      where: { id: req.params.id, ...tf },
      include: { bookings: { where: { status: { not: 'cancelled' } } } },
    });
    if (!workshop) return res.status(404).json({ error: 'Workshop nahi mila.' });
    if (workshop.status === 'cancelled') return res.status(422).json({ error: 'Ye workshop cancel ho chuka hai.' });
    if (workshop.status === 'completed') return res.status(422).json({ error: 'Ye workshop ho chuka hai.' });
    const member = await prisma.member.findFirst({ where: { id: memberId, ...tf } });
    if (!member) return res.status(404).json({ error: 'Member nahi mila.' });
    if (workshop.capacity != null && workshop.bookings.length >= workshop.capacity) {
      return res.status(409).json({ error: 'Seats full hain.' });
    }
    const dup = await B.findFirst({ where: { workshopId: workshop.id, memberId, status: { not: 'cancelled' } } });
    if (dup) return res.status(409).json({ error: 'Aap pehle se booked hain.' });
    const booking = await B.create({ data: { tenantId: tf.tenantId, workshopId: workshop.id, memberId, status: 'booked' } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'workshop.book', entity: 'WorkshopBooking', entityId: booking.id, newValue: { workshopId: workshop.id, memberId } }); } catch {}
    res.status(201).json({ booking });
  } catch (e) { next(e); }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const B = WB(res); if (!B) return;
    const memberId = req.user.memberId;
    if (!memberId) return res.status(403).json({ error: 'Member account required.' });
    const tf = tenantFilter(req);
    const booking = await B.findFirst({
      where: { workshopId: req.params.id, memberId, status: 'booked', ...tf },
      include: { workshop: true },
    });
    if (!booking) return res.status(404).json({ error: 'Active booking nahi mili.' });
    await B.update({ where: { id: booking.id }, data: { status: 'cancelled' } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'workshop.cancel', entity: 'WorkshopBooking', entityId: booking.id, newValue: { status: 'cancelled' } }); } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Staff endpoints ----------
router.use(requireRole(...STAFF));

router.get('/', async (req, res, next) => {
  try {
    const M = W(res); if (!M) return;
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.search) where.title = { contains: String(req.query.search), mode: 'insensitive' };
    const workshops = await M.findMany({
      where,
      orderBy: { scheduledAt: 'desc' },
      include: { bookings: { where: { status: { not: 'cancelled' } }, select: { memberId: true } } },
    });
    res.json({ workshops: workshops.map(withCounts) });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const M = W(res); if (!M) return;
    const tf = tenantFilter(req);
    const data = workshopSchema.parse(req.body);
    const scheduledAt = new Date(data.scheduledAt);
    if (isNaN(scheduledAt)) return res.status(400).json({ error: 'scheduledAt valid datetime ho.' });
    if (data.courseId) {
      const course = await prisma.course?.findFirst?.({ where: { id: data.courseId, ...tf } });
      if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
    }
    const workshop = await M.create({ data: { ...data, scheduledAt, ...tf } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'workshop.create', entity: 'Workshop', entityId: workshop.id, newValue: { title: workshop.title } }); } catch {}
    res.status(201).json({ workshop });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const M = W(res); if (!M) return;
    const tf = tenantFilter(req);
    const workshop = await M.findFirst({
      where: { id: req.params.id, ...tf },
      include: { bookings: { where: { status: { not: 'cancelled' } }, include: { member: { select: { id: true, name: true, email: true } } } } },
    });
    if (!workshop) return res.status(404).json({ error: 'Workshop nahi mila.' });
    res.json({ workshop: withCounts(workshop) });
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const M = W(res); if (!M) return;
    const tf = tenantFilter(req);
    const data = workshopSchema.parse(req.body);
    const scheduledAt = new Date(data.scheduledAt);
    if (isNaN(scheduledAt)) return res.status(400).json({ error: 'scheduledAt valid datetime ho.' });
    const upd = await M.updateMany({ where: { id: req.params.id, ...tf }, data: { ...data, scheduledAt } });
    if (!upd.count) return res.status(404).json({ error: 'Workshop nahi mila.' });
    const workshop = await M.findFirst({ where: { id: req.params.id, ...tf } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'workshop.update', entity: 'Workshop', entityId: req.params.id, newValue: { title: data.title } }); } catch {}
    res.json({ workshop });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const M = W(res); if (!M) return;
    const tf = tenantFilter(req);
    const del = await M.deleteMany({ where: { id: req.params.id, ...tf } });
    if (!del.count) return res.status(404).json({ error: 'Workshop nahi mila.' });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'workshop.delete', entity: 'Workshop', entityId: req.params.id }); } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/:id/bookings', async (req, res, next) => {
  try {
    const B = WB(res); if (!B) return;
    const tf = tenantFilter(req);
    const bookings = await B.findMany({
      where: { workshopId: req.params.id, ...tf },
      include: { member: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ bookings });
  } catch (e) { next(e); }
});

router.patch('/:id/bookings/:bookingId/attend', async (req, res, next) => {
  try {
    const B = WB(res); if (!B) return;
    const tf = tenantFilter(req);
    const booking = await B.findFirst({ where: { id: req.params.bookingId, workshopId: req.params.id, ...tf } });
    if (!booking) return res.status(404).json({ error: 'Booking nahi mili.' });
    const updated = await B.update({ where: { id: booking.id }, data: { status: 'attended' } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'workshop.attend', entity: 'WorkshopBooking', entityId: booking.id, newValue: { status: 'attended' } }); } catch {}
    res.json({ booking: updated });
  } catch (e) { next(e); }
});

module.exports = router;
