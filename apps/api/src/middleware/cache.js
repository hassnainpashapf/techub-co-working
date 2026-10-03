// Phase 28 Track 5: Response caching middleware.
// Caches GET JSON responses per-tenant. Never serves one tenant's (or one
// user's) data to another: the key always starts with tenantId and includes
// a user discriminator (role + id for members, keyId for API keys).

const { cache } = require('../lib/cache');

// Build a cache key that can never collide across tenants or users.
function defaultKeyFn(req) {
  const u = req.user || {};
  const tenantId = u.tenantId || 'notenant';
  let who;
  if (u.type === 'apikey') {
    who = `apikey:${u.keyId || 'unknown'}`;
  } else if (u.role === 'member') {
    // Members get a personal dashboard snapshot — scope per user.
    who = `member:${u.sub || u.id || 'unknown'}`;
  } else {
    who = `role:${u.role || 'norole'}`;
  }
  const query = req.originalUrl && req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1)
    : '';
  return `${tenantId}:${who}:${req.method}:${req.path}:${query}`;
}

// Cache GET JSON responses. Options: { ttl (seconds), keyFn }.
function cacheMiddleware({ ttl = 60, keyFn = defaultKeyFn } = {}) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    // Must run after auth — without a tenant we refuse to cache.
    if (!req.user || !req.user.tenantId) return next();

    let key;
    try {
      key = keyFn(req);
    } catch {
      return next();
    }

    const hit = cache.get(key);
    if (hit !== undefined) {
      res.set('X-Cache', 'HIT');
      return res.json(hit);
    }

    res.set('X-Cache', 'MISS');
    const origJson = res.json.bind(res);
    res.json = (body) => {
      // Only cache successful JSON responses.
      if (res.statusCode === 200) {
        try {
          cache.set(key, body, ttl);
        } catch {
          // Cache write failures must never break the response.
        }
      }
      return origJson(body);
    };
    return next();
  };
}

// Attach after auth on write-heavy routers: clears the whole tenant's cache
// after a successful mutating request (POST/PATCH/PUT/DELETE with <400).
function invalidateTenantCache(req, res, next) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400 && req.user && req.user.tenantId) {
      try {
        cache.delByPrefix(`${req.user.tenantId}:`);
      } catch {
        // Never break the response on cache errors.
      }
    }
    return origJson(body);
  };
  return next();
}

module.exports = { cacheMiddleware, invalidateTenantCache, defaultKeyFn };
