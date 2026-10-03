// Phase 28: In-memory login brute-force protection.
// 5 failed attempts in 15 min (per email+IP) -> 15 min lockout.
const attempts = new Map(); // key: email|ip -> { count, firstAt, lockedUntil }

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

function keyOf(email, ip) {
  return `${String(email || '').toLowerCase()}|${ip || ''}`;
}

function checkLockout(email, ip) {
  const rec = attempts.get(keyOf(email, ip));
  if (!rec) return { locked: false };
  const now = Date.now();
  if (rec.lockedUntil && now < rec.lockedUntil) {
    const retryMin = Math.max(1, Math.ceil((rec.lockedUntil - now) / 60000));
    return { locked: true, retryMin };
  }
  // Window expired and not locked -> reset
  if (!rec.lockedUntil && now - rec.firstAt > WINDOW_MS) {
    attempts.delete(keyOf(email, ip));
  }
  return { locked: false };
}

function recordFailure(email, ip) {
  const k = keyOf(email, ip);
  const now = Date.now();
  let rec = attempts.get(k);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    rec = { count: 0, firstAt: now, lockedUntil: null };
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS;
  }
  attempts.set(k, rec);
  return rec;
}

function recordSuccess(email, ip) {
  attempts.delete(keyOf(email, ip));
}

module.exports = { checkLockout, recordFailure, recordSuccess };
