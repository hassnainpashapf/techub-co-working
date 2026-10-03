// Phase 33 Track 7: Meeting Room Display / Kiosk.
// Public read-only endpoints for wall-mounted room displays. No auth —
// unitId is an unguessable cuid and only schedule data is exposed
// (member first names only, no PII). Rate-limited.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const displayLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests. Please try again later.',
});

// Resolve the public tenant: env slug, else first active tenant.
async function resolvePublicTenant() {
  const slug = process.env.PUBLIC_TENANT_SLUG;
  if (slug) {
    const t = await prisma.tenant.findFirst({ where: { slug, isActive: true } });
    if (t) return t;
  }
  return prisma.tenant.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
}

// Server pins TZ=UTC; bookings are stored in UTC — day window in UTC.
function todayWindow() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function firstName(full) {
  if (!full) return null;
  return String(full).trim().split(/\s+/)[0] || null;
}

function serializeBooking(b) {
  return {
    id: b.id,
    title: b.title,
    memberFirstName: b.member ? firstName(b.member.name) : null,
    startAt: b.startAt,
    endAt: b.endAt,
    status: b.status,
  };
}

// GET /api/displays/room/:unitId/schedule — today's schedule for one room.
router.get('/room/:unitId/schedule', displayLimiter, async (req, res, next) => {
  try {
    const { unitId } = z.object({ unitId: z.string().min(1) }).parse(req.params);
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        code: true,
        type: true,
        capacity: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    if (!unit) {
      return res.status(404).json({ error: { message: 'Room not found.' } });
    }

    const { start, end } = todayWindow();
    const bookings = await prisma.booking.findMany({
      where: {
        tenantId: unit.tenant.id,
        unitId: unit.id,
        status: 'confirmed',
        startAt: { gte: start, lt: end },
      },
      include: { member: { select: { name: true } } },
      orderBy: { startAt: 'asc' },
    });

    const now = new Date();
    const serialized = bookings.map(serializeBooking);
    const current = serialized.find((b) => new Date(b.startAt) <= now && new Date(b.endAt) > now) || null;
    const upcoming = serialized.filter((b) => new Date(b.startAt) > now);
    const next = upcoming.length ? upcoming[0] : null;

    res.json({
      unit: { id: unit.id, code: unit.code, type: unit.type, capacity: unit.capacity },
      tenant: { name: unit.tenant.name },
      now: now.toISOString(),
      occupied: !!current,
      current,
      next,
      schedule: serialized,
    });
  } catch (e) { next(e); }
});

// GET /api/displays/rooms/status — all meeting rooms: free/occupied + next booking.
router.get('/rooms/status', displayLimiter, async (req, res, next) => {
  try {
    const tenant = await resolvePublicTenant();
    if (!tenant) {
      return res.status(503).json({ error: { message: 'Display is not available right now.' } });
    }
    const { start, end } = todayWindow();
    const rooms = await prisma.unit.findMany({
      where: { tenantId: tenant.id, type: 'meeting_room' },
      select: {
        id: true,
        code: true,
        capacity: true,
        bookings: {
          where: { status: 'confirmed', startAt: { gte: start, lt: end } },
          include: { member: { select: { name: true } } },
          orderBy: { startAt: 'asc' },
        },
      },
      orderBy: { code: 'asc' },
    });

    const now = new Date();
    const result = rooms.map((r) => {
      const schedule = r.bookings.map(serializeBooking);
      const current = schedule.find((b) => new Date(b.startAt) <= now && new Date(b.endAt) > now) || null;
      const next = schedule.find((b) => new Date(b.startAt) > now) || null;
      return {
        id: r.id,
        code: r.code,
        capacity: r.capacity,
        occupied: !!current,
        currentTitle: current ? current.title : null,
        currentEndsAt: current ? current.endAt : null,
        nextTitle: next ? next.title : null,
        nextStartsAt: next ? next.startAt : null,
      };
    });

    res.json({ tenant: { name: tenant.name }, now: now.toISOString(), rooms: result });
  } catch (e) { next(e); }
});

module.exports = router;
