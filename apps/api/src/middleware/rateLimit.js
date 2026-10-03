// Rate limiting middleware (in-memory sliding window).
// For production scale, swap the store with Redis.

const windows = new Map();

function rateLimit({ windowMs = 60000, max = 100, keyBy = 'ip', message } = {}) {
  return (req, res, next) => {
    const key =
      keyBy === 'user' && req.user
        ? `u:${req.user.id}`
        : `ip:${req.ip || req.headers['x-forwarded-for'] || 'unknown'}`;

    const now = Date.now();
    const bucketKey = `${key}:${Math.floor(now / windowMs)}`;

    let bucket = windows.get(bucketKey);
    if (!bucket) {
      // Cleanup old buckets opportunistically
      if (windows.size > 10000) {
        for (const [k] of windows) {
          if (Number(k.split(':').pop()) < Math.floor(now / windowMs) - 1) {
            windows.delete(k);
          }
        }
      }
      bucket = { count: 0 };
      windows.set(bucketKey, bucket);
    }

    bucket.count += 1;

    const resetIn = Math.ceil((Math.floor(now / windowMs) * windowMs + windowMs - now) / 1000);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - bucket.count));
    res.setHeader('X-RateLimit-Reset', resetIn);

    if (bucket.count > max) {
      return res.status(429).json({
        error: {
          message: message || 'Too many requests, please try again later.',
          code: 'RATE_LIMITED',
        },
      });
    }
    next();
  };
}

// Presets
const loginLimiter = rateLimit({ windowMs: 60000, max: 5, message: 'Too many login attempts. Try again in a minute.' });
const apiLimiter = rateLimit({ windowMs: 60000, max: 200 });
const strictLimiter = rateLimit({ windowMs: 60000, max: 20 });

module.exports = { rateLimit, loginLimiter, apiLimiter, strictLimiter };
