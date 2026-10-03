// Dedicated rate limiter for password-reset endpoints: 5 requests/hour,
// keyed by email + IP (prevents both IP-wide abuse and per-account harassment).
// In-memory sliding window (same pattern as middleware/rateLimit.js).

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX = 5;

const windows = new Map(); // key -> { count, start }

function bucketKey(email, ip) {
  const e = String(email || '').trim().toLowerCase();
  const i = ip || 'unknown';
  return `${e}|${i}`;
}

// Pure + testable. `now` is injectable for tests.
function checkResetLimit(email, ip, now = Date.now()) {
  const key = bucketKey(email, ip);
  let b = windows.get(key);
  if (!b || now - b.start >= WINDOW_MS) {
    b = { count: 0, start: now };
    windows.set(key, b);
  }
  b.count += 1;
  const allowed = b.count <= MAX;
  return {
    allowed,
    remaining: Math.max(0, MAX - b.count),
    retryAfterMs: b.start + WINDOW_MS - now,
  };
}

function resetPasswordLimiter(req, res, next) {
  const email = req.body && req.body.email ? req.body.email : '';
  const r = checkResetLimit(email, req.ip);
  if (!r.allowed) {
    return res.status(429).json({
      error: {
        message: 'Too many password reset requests. Please try again later.',
        code: 'RATE_LIMITED',
      },
    });
  }
  next();
}

// Test helper only.
function _clearForTests() {
  windows.clear();
}

module.exports = { resetPasswordLimiter, checkResetLimit, _clearForTests, WINDOW_MS, MAX };
