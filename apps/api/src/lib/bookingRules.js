// Booking rules engine — per-tenant configurable constraints for meeting room
// bookings. Settings live in the existing `Setting` model (no migration).
//
// Keys:
//   bookingBufferMinutes   (default 15)  — gap required before/after other bookings
//   bookingMaxHours         (default 4)   — max length of a single booking
//   bookingAdvanceDays      (default 30)  — how far in the future bookings may start
//   bookingMinNoticeMinutes (default 60)  — bookings must start at least this soon before

const prisma = require('./prisma');

const DEFAULTS = {
  bookingBufferMinutes: 15,
  bookingMaxHours: 4,
  bookingAdvanceDays: 30,
  bookingMinNoticeMinutes: 60,
};

const LIMITS = {
  bookingBufferMinutes: { min: 0, max: 240 },
  bookingMaxHours: { min: 0.5, max: 24 },
  bookingAdvanceDays: { min: 1, max: 365 },
  bookingMinNoticeMinutes: { min: 0, max: 1440 },
};

function clamp(key, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS[key];
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, n));
}

async function getBookingRuleSettings(tenantId) {
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { in: Object.keys(DEFAULTS) } },
  });
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = clamp(key, map[key]);
  return out;
}

async function setBookingRuleSettings(tenantId, values) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (values[key] === undefined) continue;
    const v = clamp(key, values[key]);
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: String(v) },
      create: { tenantId, key, value: String(v) },
    });
    out[key] = v;
  }
  return out;
}

// Returns { valid: true } or { valid: false, code, message }.
// Neighbour lookups are tenant-scoped; only confirmed bookings count.
async function validateBookingRules({ tenantId, unitId, startAt, endAt, excludeId = null }) {
  const s = await getBookingRuleSettings(tenantId);
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const now = Date.now();

  if (!(start < end)) {
    return { valid: false, code: 'INVALID_RANGE', message: 'End time must be after start time.' };
  }

  const durationMs = end - start;
  if (durationMs > s.bookingMaxHours * 3600e3) {
    return {
      valid: false,
      code: 'MAX_DURATION_EXCEEDED',
      message: `Bookings cannot be longer than ${s.bookingMaxHours} hour(s). Please shorten your booking.`,
    };
  }
  if (start - now < s.bookingMinNoticeMinutes * 60e3) {
    return {
      valid: false,
      code: 'MIN_NOTICE_NOT_MET',
      message: `Bookings need at least ${s.bookingMinNoticeMinutes} minute(s) advance notice. Please pick a later start time.`,
    };
  }
  if (start - now > s.bookingAdvanceDays * 86400e3) {
    return {
      valid: false,
      code: 'TOO_FAR_IN_ADVANCE',
      message: `Bookings can only be made up to ${s.bookingAdvanceDays} day(s) in advance.`,
    };
  }

  if (s.bookingBufferMinutes > 0) {
    const bufferMs = s.bookingBufferMinutes * 60e3;
    const neighbours = await prisma.booking.findMany({
      where: {
        tenantId,
        unitId,
        status: 'confirmed',
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startAt: { lt: new Date(end + bufferMs) },
        endAt: { gt: new Date(start - bufferMs) },
      },
      select: { startAt: true, endAt: true },
      orderBy: { startAt: 'asc' },
    });
    for (const b of neighbours) {
      const bStart = new Date(b.startAt).getTime();
      const bEnd = new Date(b.endAt).getTime();
      // True overlaps are rejected separately (409); buffer only checks adjacency.
      if (bStart < end && bEnd > start) continue;
      if (bEnd <= start) {
        const gapMin = Math.round((start - bEnd) / 60e3);
        if (start - bEnd < bufferMs) {
          return {
            valid: false,
            code: 'BUFFER_VIOLATION',
            message: `A ${s.bookingBufferMinutes}-minute gap is required between bookings (only ${gapMin} minute(s) after the previous booking).`,
          };
        }
      } else if (bStart >= end) {
        const gapMin = Math.round((bStart - end) / 60e3);
        if (bStart - end < bufferMs) {
          return {
            valid: false,
            code: 'BUFFER_VIOLATION',
            message: `A ${s.bookingBufferMinutes}-minute gap is required between bookings (only ${gapMin} minute(s) before the next booking).`,
          };
        }
      }
    }
  }

  return { valid: true, settings: s };
}

module.exports = {
  DEFAULTS,
  LIMITS,
  getBookingRuleSettings,
  setBookingRuleSettings,
  validateBookingRules,
};
