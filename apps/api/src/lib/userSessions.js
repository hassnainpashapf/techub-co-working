// Phase 32 Track 5: UserSession helpers (login session tracking + revocation).
// Alag table hai track 1 ke refresh-token work se — dono independent kaam karte hain.
const prisma = require('./prisma');

// chhota in-memory cache: revoked session ids (60s TTL) — har request par DB hit se bachne ke liye
const revokedCache = new Map(); // sid -> expiresAt (ms)
const CACHE_TTL_MS = 60 * 1000;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 64);
  return (req.ip || '').slice(0, 64) || null;
}

// user-agent se readable device name — koi dependency nahi
function parseDevice(ua) {
  if (!ua) return 'Unknown device';
  const s = String(ua);
  let os = 'Unknown OS';
  if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  let browser = '';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = 'Chrome';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Safari\//i.test(s) && /Version\//i.test(s)) browser = 'Safari';
  const mobile = /Mobile|iPhone|Android/i.test(s) ? ' (mobile)' : '';
  return `${browser ? browser + ' on ' : ''}${os}${mobile}`.slice(0, 120);
}

// Login par session row — kabhi login fail nahi hone dena (defensive)
async function recordLoginSession(req, user) {
  try {
    const ua = req.headers['user-agent'] || null;
    return await prisma.userSession.create({
      data: {
        userId: user.id,
        ipAddress: clientIp(req),
        userAgent: ua ? ua.slice(0, 500) : null,
        deviceName: parseDevice(ua),
      },
    });
  } catch (_e) {
    return null;
  }
}

// current session ki lastActiveAt touch (sirf 5 min se purani ho to — 1 query)
async function touchSession(sid) {
  if (!sid) return;
  try {
    await prisma.userSession.updateMany({
      where: {
        id: sid,
        revokedAt: null,
        lastActiveAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
      data: { lastActiveAt: new Date() },
    });
  } catch (_e) {
    /* ignore */
  }
}

async function isSessionRevoked(sid) {
  if (!sid) return false;
  const cached = revokedCache.get(sid);
  if (cached && cached > Date.now()) return true;
  if (cached) revokedCache.delete(sid);
  try {
    const s = await prisma.userSession.findUnique({
      where: { id: sid },
      select: { revokedAt: true },
    });
    if (s && s.revokedAt) {
      revokedCache.set(sid, Date.now() + CACHE_TTL_MS);
      return true;
    }
    return false;
  } catch (_e) {
    return false; // DB issue par request block nahi karni
  }
}

async function revokeSession(userId, sid) {
  const s = await prisma.userSession.updateMany({
    where: { id: sid, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (s.count > 0) revokedCache.set(sid, Date.now() + CACHE_TTL_MS);
  return s.count > 0;
}

async function revokeAllExcept(userId, exceptSid) {
  const res = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSid ? { id: { not: exceptSid } } : {}) },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

async function latestActiveSession(userId) {
  try {
    return await prisma.userSession.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' },
      select: { id: true },
    });
  } catch (_e) {
    return null;
  }
}

module.exports = {
  clientIp,
  parseDevice,
  recordLoginSession,
  touchSession,
  isSessionRevoked,
  revokeSession,
  revokeAllExcept,
  latestActiveSession,
};
