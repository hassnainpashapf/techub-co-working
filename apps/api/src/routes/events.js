// Phase 33: Community Events + RSVP.
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

const STATUSES = ['upcoming', 'ongoing', 'completed', 'cancelled'];
const RSVP_STATUSES = ['going', 'interested', 'cancelled'];

// Resolve the member record for the logged-in user.
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

async function rsvpCounts(eventId) {
  const rows = await prisma.eventRsvp.groupBy({
    by: ['status'],
    where: { eventId, status: { in: ['going', 'interested'] } },
    _count: { status: true },
  });
  const out = { going: 0, interested: 0 };
  for (const r of rows) out[r.status] = r._count.status;
  return out;
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  location: z.string().max(200).optional().nullable(),
  capacity: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().url().max(1000).optional().nullable(),
  status: z.enum(STATUSES).optional().default('upcoming'),
}).refine((d) => new Date(d.endsAt) > new Date(d.startsAt), { message: 'endsAt must be after startsAt' });

// GET /api/events — upcoming list (members see non-cancelled; staff see all with ?all=1)
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const isStaff = STAFF.includes(req.user.role);
    const where = { ...tf };
    if (!isStaff || req.query.all !== '1') {
      where.status = { not: 'cancelled' };
    } else if (req.query.status) {
      where.status = req.query.status;
    }
    const events = await prisma.communityEvent.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      take: 100,
      include: { _count: { select: { rsvps: true } } },
    });
    const withCounts = await Promise.all(events.map(async (e) => ({ ...e, counts: await rsvpCounts(e.id) })));
    return res.json({ events: withCounts });
  } catch (err) {
    return next(err);
  }
});

// POST /api/events — staff creates event
router.post('/', staffOnly, validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await prisma.communityEvent.create({
      data: { tenantId: tf.tenantId, createdBy: req.user.sub, ...req.body },
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'event.create',
      entity: 'CommunityEvent', entityId: ev.id, newValue: { title: ev.title },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.status(201).json({ event: ev });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/events/:id — staff updates
router.patch('/:id', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await prisma.communityEvent.findFirst({ where: { id: req.params.id, ...tf } });
    if (!ev) return res.status(404).json({ error: { message: 'Event not found.' } });
    const allowed = ['title', 'description', 'startsAt', 'endsAt', 'location', 'capacity', 'imageUrl', 'status'];
    const data = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    const updated = await prisma.communityEvent.update({ where: { id: ev.id }, data });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'event.update',
      entity: 'CommunityEvent', entityId: ev.id, newValue: data,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ event: updated });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/events/:id — staff deletes
router.delete('/:id', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await prisma.communityEvent.findFirst({ where: { id: req.params.id, ...tf } });
    if (!ev) return res.status(404).json({ error: { message: 'Event not found.' } });
    await prisma.communityEvent.delete({ where: { id: ev.id } });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'event.delete',
      entity: 'CommunityEvent', entityId: ev.id, oldValue: { title: ev.title },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// GET /api/events/:id/rsvps — staff sees RSVP list
router.get('/:id/rsvps', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await prisma.communityEvent.findFirst({ where: { id: req.params.id, ...tf } });
    if (!ev) return res.status(404).json({ error: { message: 'Event not found.' } });
    const rsvps = await prisma.eventRsvp.findMany({
      where: { eventId: ev.id },
      include: { member: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ rsvps, counts: await rsvpCounts(ev.id) });
  } catch (err) {
    return next(err);
  }
});

const rsvpSchema = z.object({ status: z.enum(RSVP_STATUSES) });

// POST /api/events/:id/rsvp — member RSVPs
router.post('/:id/rsvp', validateBody(rsvpSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await prisma.communityEvent.findFirst({ where: { id: req.params.id, ...tf } });
    if (!ev) return res.status(404).json({ error: { message: 'Event not found.' } });
    if (ev.status === 'cancelled') return res.status(400).json({ error: { message: 'This event is cancelled.' } });
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });

    if (req.body.status !== 'cancelled' && ev.capacity) {
      const going = await prisma.eventRsvp.count({
        where: { eventId: ev.id, status: 'going', memberId: { not: member.id } },
      });
      if (going >= ev.capacity) {
        return res.status(409).json({ error: { message: 'Event is full.' } });
      }
    }

    const rsvp = await prisma.eventRsvp.upsert({
      where: { eventId_memberId: { eventId: ev.id, memberId: member.id } },
      update: { status: req.body.status },
      create: { eventId: ev.id, memberId: member.id, status: req.body.status },
    });
    return res.json({ rsvp, counts: await rsvpCounts(ev.id) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
