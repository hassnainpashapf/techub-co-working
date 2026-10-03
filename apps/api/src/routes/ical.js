// Phase 36 Track 7: iCal Booking Feeds.
// Members get a private, unguessable feed URL they can subscribe to from
// Google / Apple / Outlook calendar. The feed always reflects live bookings.
const express = require('express');
const crypto = require('crypto');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const feedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests. Please try again later.',
});

// Resolve the member record for the logged-in user (same pattern as portal.js).
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

function schemaReady(res) {
  if (!prisma.calendarFeedToken) {
    res.status(503).json({ error: { message: 'Calendar feeds are not available yet.' } });
    return false;
  }
  return true;
}

// --- RFC 5545 helpers -------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0');
}

// Date -> "YYYYMMDDTHHMMSSZ" (UTC)
function icalDate(d) {
  const t = new Date(d);
  return (
    t.getUTCFullYear() +
    pad(t.getUTCMonth() + 1) +
    pad(t.getUTCDate()) +
    'T' +
    pad(t.getUTCHours()) +
    pad(t.getUTCMinutes()) +
    pad(t.getUTCSeconds()) +
    'Z'
  );
}

// Escape TEXT values per RFC 5545 section 3.3.11
function icalText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Fold lines longer than 75 octets (RFC 5545 section 3.1). ASCII-safe: our
// escaped text is folded on UTF-8 byte boundaries to never split a rune.
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let i = 0;
  while (i < bytes.length) {
    let end = Math.min(i + 75, bytes.length);
    // Don't split a multi-byte UTF-8 sequence: back up to a char boundary.
    while (end > i && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    if (end === i) end = Math.min(i + 75, bytes.length); // degenerate safety
    parts.push(bytes.slice(i, end).toString('utf8'));
    i = end;
  }
  return parts.join('\r\n ');
}

function buildIcs({ calName, events }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CoworkOS//Member Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icalText(calName)}`,
  ];
  const stamp = icalDate(new Date());
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icalDate(e.start)}`,
      `DTEND:${icalDate(e.end)}`,
      `SUMMARY:${icalText(e.summary)}`,
      `LOCATION:${icalText(e.location)}`,
      `DESCRIPTION:${icalText(e.description)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// --- Public feed (token auth, no login) -------------------------------------

// GET /api/ical/feed/:token.ics — subscribe-able calendar of upcoming bookings.
router.get('/feed/:token', feedLimiter, async (req, res, next) => {
  try {
    if (!schemaReady(res)) return;
    const raw = String(req.params.token || '');
    const token = raw.replace(/\.ics$/i, '');
    if (!token) return res.status(404).type('text/plain').send('Not found');

    const feed = await prisma.calendarFeedToken.findUnique({
      where: { token },
      include: { member: true, tenant: { select: { id: true, name: true, slug: true } } },
    });
    if (!feed || !feed.member) {
      return res.status(404).type('text/plain').send('Feed not found');
    }

    const now = new Date();
    const bookings = await prisma.booking.findMany({
      where: {
        tenantId: feed.tenantId,
        memberId: feed.memberId,
        status: 'confirmed',
        endAt: { gte: now },
      },
      include: { unit: { select: { code: true, name: true, type: true } } },
      orderBy: { startAt: 'asc' },
      take: 200,
    });

    const events = bookings.map((b) => ({
      uid: `booking-${b.id}@${feed.tenant.slug || feed.tenantId}.coworkos`,
      start: b.startAt,
      end: b.endAt,
      summary: b.title || `Booking — ${b.unit?.code || 'space'}`,
      location: [b.unit?.name || b.unit?.code, b.unit?.type].filter(Boolean).join(' • ') || 'Coworking space',
      description: `Booked via ${feed.tenant.name || 'CoworkOS'}`,
    }));

    const ics = buildIcs({
      calName: `${feed.member.name || 'My'} Bookings — ${feed.tenant.name || 'CoworkOS'}`,
      events,
    });

    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bookings.ics"',
      'Cache-Control': 'private, max-age=300',
    });
    return res.send(ics);
  } catch (err) {
    return next(err);
  }
});

// --- Member self-service (authenticated) ------------------------------------

router.use(authenticate, requireTenantUser);

// Only members manage their own feed.
router.use((req, res, next) => {
  if (req.user.role !== 'member') {
    return res.status(403).json({ error: { message: 'Member access only.' } });
  }
  return next();
});

function newToken() {
  return crypto.randomBytes(24).toString('hex'); // 48 unguessable hex chars
}

// GET /api/ical/my — get (or lazily create) my feed token.
router.get('/my', async (req, res, next) => {
  try {
    if (!schemaReady(res)) return;
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });

    let feed = await prisma.calendarFeedToken.findUnique({
      where: { tenantId_memberId: { tenantId: member.tenantId, memberId: member.id } },
    });
    if (!feed) {
      feed = await prisma.calendarFeedToken.create({
        data: { tenantId: member.tenantId, memberId: member.id, token: newToken() },
      });
    }
    return res.json({ token: feed.token, path: `/ical/feed/${feed.token}.ics` });
  } catch (err) {
    return next(err);
  }
});

// POST /api/ical/regenerate — invalidate the old URL and issue a fresh token.
router.post('/regenerate', async (req, res, next) => {
  try {
    if (!schemaReady(res)) return;
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });

    const feed = await prisma.calendarFeedToken.upsert({
      where: { tenantId_memberId: { tenantId: member.tenantId, memberId: member.id } },
      update: { token: newToken() },
      create: { tenantId: member.tenantId, memberId: member.id, token: newToken() },
    });
    return res.json({ token: feed.token, path: `/ical/feed/${feed.token}.ics` });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
