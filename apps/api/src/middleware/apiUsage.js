// Phase 36: API usage analytics + per-key rate limiting.
// - logApiUsage(req, res, record): fire-and-forget request logging for API-key callers.
// - checkRateLimit(keyId, limitPerMin): in-memory sliding-window limiter (60s).
// Logging/rate-limit never break the request path.
const prisma = require('../lib/prisma');

// keyId -> array of request timestamps (ms), pruned on every check
const windows = new Map();
// Bound memory: drop idle windows every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [k, arr] of windows) {
    while (arr.length && arr[0] <= cutoff) arr.shift();
    if (!arr.length) windows.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

function checkRateLimit(keyId, limitPerMin) {
  if (!limitPerMin || limitPerMin <= 0) return { allowed: true };
  const now = Date.now();
  const cutoff = now - 60000;
  let arr = windows.get(keyId);
  if (!arr) {
    arr = [];
    windows.set(keyId, arr);
  }
  while (arr.length && arr[0] <= cutoff) arr.shift();
  if (arr.length >= limitPerMin) {
    return { allowed: false, retryAfterSec: Math.ceil((arr[0] + 60000 - now) / 1000) || 1 };
  }
  arr.push(now);
  return { allowed: true };
}

function normalizeEndpoint(req) {
  // req.route is populated once the route matches; the finish handler runs after,
  // so path params stay templated (e.g. /api/bookings/:id) instead of raw ids.
  if (req.route && req.route.path) {
    const full = (req.baseUrl || '') + req.route.path;
    return full.replace(/\/+$/, '') || '/';
  }
  return req.path;
}

function logApiUsage(req, res, record) {
  if (!prisma.apiUsageLog) return; // schema not merged yet — skip silently
  const start = Date.now();
  res.on('finish', () => {
    try {
      prisma.apiUsageLog
        .create({
          data: {
            tenantId: record.tenantId,
            apiKeyId: record.id,
            endpoint: normalizeEndpoint(req),
            method: req.method,
            statusCode: res.statusCode,
            durationMs: Date.now() - start,
          },
        })
        .catch(() => {});
    } catch {
      // never break the request
    }
  });
}

module.exports = { checkRateLimit, logApiUsage, normalizeEndpoint };
