// Phase 44 Track 7: Agenda & Speakers
//
// MOUNT (coordinator server.js me ADD karein):
//   const eventAgenda = require('./routes/event-agenda');
//   app.use('/api/event-agenda', eventAgenda.router);            // staff (auth)
//   app.use('/api/event-agenda', eventAgenda.publicRouter);       // public (no auth)
// NOTE: publicRouter me paths '/public/...' hain — dono routers ek base
// par Express multi-router pattern se chalte hain (phase 39 lead-public jaisa).
//
// INTEGRATION NOTES (coordinator kare):
// 1) PUBLIC EVENT PAGE (Track 1 owns: apps/web/app/events/[slug]/page.js):
//    - Agenda timeline: GET /api/event-agenda/public/:eventId/agenda
//      → { speakers: [{id,name,title,company,bio,photoUrl}],
//           sessions: [{id,title,description,startTime,endTime,location,speaker?}] }
//    - Speakers grid: upar wale speakers array se render (2-col grid, photo + name + title).
//    - Event public nahi ho to 404 (track 1 ka events-public isPublic check karta hai).
// 2) STAFF EVENT DETAIL (events page owner — track 2): "Agenda" tab jorna:
//    - Speakers CRUD: POST /api/event-agenda/speakers {eventId,name,title?,company?,bio?,photoUrl?}
//    - GET /api/event-agenda/speakers?eventId=, PATCH /speakers/:id, DELETE /speakers/:id
//    - Sessions CRUD: POST /api/event-agenda/sessions {eventId,title,description?,speakerId?,startTime,endTime,location?}
//    - GET /api/event-agenda/sessions?eventId= (sortOrder,startTime se sorted),
//      PATCH /sessions/:id, DELETE /sessions/:id,
//      POST /api/event-agenda/sessions/reorder {order:[{id,sortOrder}]}
//
// Backend exports (helpers): getEventAgenda(tenantId, eventId) — public
// page ya reports ke liye reuse ho sakta hai.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

// ---- 503 guard (fragment merge/migration se pehle safe fail) ----
function modelReady() {
  return prisma && typeof prisma.eventSpeaker?.findMany === 'function'
    && typeof prisma.eventSession?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'event-agenda migration pending' });
  next();
}

// ---- helpers ----
async function tenantEvent(eventId, tf) {
  return prisma.communityEvent.findFirst({ where: { id: eventId, ...tf } });
}

async function getEventAgenda(tenantId, eventId) {
  const [speakers, sessions] = await Promise.all([
    prisma.eventSpeaker.findMany({
      where: { tenantId, eventId },
      orderBy: { name: 'asc' },
    }),
    prisma.eventSession.findMany({
      where: { tenantId, eventId },
      include: { speaker: { select: { id: true, name: true, title: true, company: true, photoUrl: true } } },
      orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }],
    }),
  ]);
  return { speakers, sessions };
}

// ===================== STAFF ROUTER (auth) =====================
const router = express.Router();
router.use(authenticate, requireTenantUser, staffOnly, guard);

// ---- speakers ----
router.get('/speakers', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { eventId } = req.query;
    if (!eventId) return res.status(400).json({ error: 'eventId required' });
    const ev = await tenantEvent(eventId, tf);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    const speakers = await prisma.eventSpeaker.findMany({
      where: { ...tf, eventId },
      orderBy: { name: 'asc' },
    });
    res.json({ speakers });
  } catch (e) { next(e); }
});

const speakerSchema = z.object({
  eventId: z.string().min(1),
  name: z.string().min(1).max(120),
  title: z.string().max(120).optional(),
  company: z.string().max(120).optional(),
  bio: z.string().max(2000).optional(),
  photoUrl: z.string().url().max(500).optional().or(z.literal('')).optional(),
});

router.post('/speakers', validateBody(speakerSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await tenantEvent(req.body.eventId, tf);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    const { photoUrl, ...rest } = req.body;
    const speaker = await prisma.eventSpeaker.create({
      data: { ...rest, photoUrl: photoUrl || null, tenantId: tf.tenantId },
    });
    await writeAudit(req, 'event.speaker.create', 'EventSpeaker', speaker.id, { eventId: req.body.eventId });
    res.status(201).json({ speaker });
  } catch (e) { next(e); }
});

const speakerPatch = speakerSchema.partial().omit({ eventId: true });

router.patch('/speakers/:id', validateBody(speakerPatch), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.eventSpeaker.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'speaker not found' });
    const { photoUrl, ...rest } = req.body;
    const speaker = await prisma.eventSpeaker.update({
      where: { id: req.params.id },
      data: { ...rest, ...(photoUrl !== undefined ? { photoUrl: photoUrl || null } : {}) },
    });
    await writeAudit(req, 'event.speaker.update', 'EventSpeaker', speaker.id, {});
    res.json({ speaker });
  } catch (e) { next(e); }
});

router.delete('/speakers/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.eventSpeaker.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'speaker not found' });
    await prisma.eventSpeaker.delete({ where: { id: req.params.id } });
    await writeAudit(req, 'event.speaker.delete', 'EventSpeaker', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- sessions ----
router.get('/sessions', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { eventId } = req.query;
    if (!eventId) return res.status(400).json({ error: 'eventId required' });
    const ev = await tenantEvent(eventId, tf);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    const sessions = await prisma.eventSession.findMany({
      where: { ...tf, eventId },
      include: { speaker: { select: { id: true, name: true, title: true, company: true, photoUrl: true } } },
      orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }],
    });
    res.json({ sessions });
  } catch (e) { next(e); }
});

const sessionBase = z.object({
  eventId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  speakerId: z.string().min(1).optional().nullable(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  location: z.string().max(200).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});
const sessionSchema = sessionBase.refine(d => d.endTime > d.startTime, { message: 'endTime must be after startTime', path: ['endTime'] });

router.post('/sessions', validateBody(sessionSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await tenantEvent(req.body.eventId, tf);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    if (req.body.speakerId) {
      const sp = await prisma.eventSpeaker.findFirst({ where: { id: req.body.speakerId, eventId: req.body.eventId, ...tf } });
      if (!sp) return res.status(400).json({ error: 'speaker does not belong to this event' });
    }
    const session = await prisma.eventSession.create({
      data: { ...req.body, tenantId: tf.tenantId },
      include: { speaker: { select: { id: true, name: true, title: true, company: true, photoUrl: true } } },
    });
    await writeAudit(req, 'event.session.create', 'EventSession', session.id, { eventId: req.body.eventId });
    res.status(201).json({ session });
  } catch (e) { next(e); }
});

const sessionPatch = sessionBase.partial().omit({ eventId: true });

router.patch('/sessions/:id', validateBody(sessionPatch), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.eventSession.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'session not found' });
    if (req.body.speakerId) {
      const sp = await prisma.eventSpeaker.findFirst({ where: { id: req.body.speakerId, eventId: existing.eventId, ...tf } });
      if (!sp) return res.status(400).json({ error: 'speaker does not belong to this event' });
    }
    if (req.body.startTime && req.body.endTime && req.body.endTime <= req.body.startTime) {
      return res.status(400).json({ error: 'endTime must be after startTime' });
    }
    const session = await prisma.eventSession.update({
      where: { id: req.params.id },
      data: req.body,
      include: { speaker: { select: { id: true, name: true, title: true, company: true, photoUrl: true } } },
    });
    await writeAudit(req, 'event.session.update', 'EventSession', session.id, {});
    res.json({ session });
  } catch (e) { next(e); }
});

router.delete('/sessions/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.eventSession.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'session not found' });
    await prisma.eventSession.delete({ where: { id: req.params.id } });
    await writeAudit(req, 'event.session.delete', 'EventSession', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/sessions/reorder', validateBody(z.object({
  order: z.array(z.object({ id: z.string().min(1), sortOrder: z.number().int().min(0) })).min(1).max(100),
})), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ids = req.body.order.map(o => o.id);
    const existing = await prisma.eventSession.findMany({ where: { id: { in: ids }, ...tf }, select: { id: true } });
    if (existing.length !== ids.length) return res.status(400).json({ error: 'some sessions not found' });
    await prisma.$transaction(
      req.body.order.map(o => prisma.eventSession.update({ where: { id: o.id }, data: { sortOrder: o.sortOrder } }))
    );
    await writeAudit(req, 'event.session.reorder', 'EventSession', ids[0], { count: ids.length });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ===================== PUBLIC ROUTER (no auth) =====================
const publicRouter = express.Router();
publicRouter.use(guard);

// GET /api/event-agenda/public/:eventId/agenda — public event page (Track 1)
// tenant slug ki bajaye eventId par — Track 1 ka events-public eventId
// public list se deta hai, is liye isPublic check wahan pehle ho chuka hota hai.
publicRouter.get('/public/:eventId/agenda', async (req, res, next) => {
  try {
    const ev = await prisma.communityEvent.findUnique({ where: { id: req.params.eventId } });
    if (!ev || !ev.isPublic) return res.status(404).json({ error: 'event not found' });
    const agenda = await getEventAgenda(ev.tenantId, ev.id);
    res.json(agenda);
  } catch (e) { next(e); }
});

module.exports = { router, publicRouter, getEventAgenda };
