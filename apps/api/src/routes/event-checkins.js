// Phase 40 Track 6: Event Check-in & Attendance Tracking.
// IMPORTANT: events.js ko nahi chhera — yeh router bhi '/api/events' par mount
// hoga (Express ek path par multiple routers chala leta hai; Track 8 Phase 39
// me bhi yahi pattern use hua tha).
// MOUNT (coordinator server.js me ADD karein):
//   const eventCheckins = require('./routes/event-checkins');
//   app.use('/api/events', eventCheckins.router);
//
// No-show signal (badges track / coordinator ke liye):
//   const { getEventNoShows } = require('./routes/event-checkins');
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF_SCAN = ['receptionist', 'manager', 'operations_manager', 'admin', 'ceo', 'super_admin'];
const scanOnly = requireRole(...STAFF_SCAN);

// 503 guard — fragment merge/migration se pehle endpoints safe fail hon.
function modelReady() {
  return prisma && typeof prisma.eventCheckin?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'event-checkins migration pending' });
  next();
}
router.use(guard);

async function tenantEvent(req, id) {
  const tf = tenantFilter(req);
  return prisma.communityEvent.findFirst({ where: { id, ...tf } });
}

// --- QR verify (member-qr.js se cross-compatible, stateless HMAC) ---
const QR_VERSION = 1;
function qrSecret() {
  return process.env.JWT_ACCESS_SECRET || '';
}
function verifyMemberQr(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', qrSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || payload.v !== QR_VERSION || !payload.memberId || !payload.tenantId) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp && Date.now() > payload.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

// POST /api/events/:id/checkin — single member check-in (staff/reception)
const checkinSchema = z.object({
  memberId: z.string().min(1),
});
router.post('/:id/checkin', scanOnly, validateBody(checkinSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await tenantEvent(req, req.params.id);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    const member = await prisma.member.findFirst({ where: { id: req.body.memberId, ...tf } });
    if (!member) return res.status(404).json({ error: 'member not found' });
    const ci = await prisma.eventCheckin.upsert({
      where: { eventId_memberId: { eventId: ev.id, memberId: member.id } },
      update: {},
      create: { eventId: ev.id, memberId: member.id, checkedInBy: req.user.sub, method: 'manual' },
    });
    await writeAudit(req, 'event_checkin', { eventId: ev.id, memberId: member.id });
    return res.json({ checkin: ci });
  } catch (e) {
    next(e);
  }
});

// POST /api/events/:id/bulk-checkin — QR scanner batch { tokens: ["body.sig", ...] }
const bulkSchema = z.object({
  tokens: z.array(z.string().min(1)).min(1).max(100),
});
router.post('/:id/bulk-checkin', scanOnly, validateBody(bulkSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await tenantEvent(req, req.params.id);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    const results = { ok: 0, failed: [] };
    for (const token of req.body.tokens) {
      const v = verifyMemberQr(token);
      if (!v.ok || v.payload.tenantId !== tf.tenantId) {
        results.failed.push({ reason: v.reason || 'tenant-mismatch' });
        continue;
      }
      const member = await prisma.member.findFirst({ where: { id: v.payload.memberId, ...tf } });
      if (!member) {
        results.failed.push({ reason: 'member-not-found' });
        continue;
      }
      await prisma.eventCheckin.upsert({
        where: { eventId_memberId: { eventId: ev.id, memberId: member.id } },
        update: {},
        create: { eventId: ev.id, memberId: member.id, checkedInBy: req.user.sub, method: 'qr' },
      });
      results.ok += 1;
    }
    await writeAudit(req, 'event_bulk_checkin', { eventId: ev.id, ok: results.ok });
    return res.json(results);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/events/:id/checkin/:memberId — check-in undo (staff)
router.delete('/:id/checkin/:memberId', scanOnly, async (req, res, next) => {
  try {
    const ev = await tenantEvent(req, req.params.id);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    await prisma.eventCheckin.deleteMany({
      where: { eventId: ev.id, memberId: req.params.memberId },
    });
    await writeAudit(req, 'event_checkin_undo', { eventId: ev.id, memberId: req.params.memberId });
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/events/:id/attendees — RSVP vs actual + no-show list
async function getAttendees(eventId, tenantId) {
  const rsvps = await prisma.eventRsvp.findMany({
    where: { eventId, status: { in: ['going', 'interested'] } },
    include: { member: { select: { id: true, name: true, email: true } } },
  });
  const checkins = await prisma.eventCheckin.findMany({
    where: { eventId },
    include: { member: { select: { id: true, name: true, email: true } } },
  });
  const checkedIds = new Set(checkins.map((c) => c.memberId));
  const goingRsvps = rsvps.filter((r) => r.status === 'going');
  const noShows = goingRsvps
    .filter((r) => !checkedIds.has(r.memberId))
    .map((r) => ({ id: r.member.id, name: r.member.name, email: r.member.email }));
  return {
    going: goingRsvps.length,
    interested: rsvps.filter((r) => r.status === 'interested').length,
    checkedIn: checkins.length,
    checkins: checkins.map((c) => ({
      memberId: c.memberId, name: c.member.name, checkedInAt: c.checkedInAt, method: c.method,
    })),
    noShows,
    noShowCount: noShows.length,
  };
}

router.get('/:id/attendees', scanOnly, async (req, res, next) => {
  try {
    const ev = await tenantEvent(req, req.params.id);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    return res.json({ eventId: ev.id, ...(await getAttendees(ev.id, tenantFilter(req).tenantId)) });
  } catch (e) {
    next(e);
  }
});

// Badges track (Track 5) ke liye exported helper — RSVP 'going' lekin check-in nahi.
async function getEventNoShows(eventId) {
  const att = await getAttendees(eventId);
  return att.noShows; // [{id, name, email}]
}

module.exports = { router, getAttendees, getEventNoShows };
