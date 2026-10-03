// Phase 24: API key authentication for integrations.
// Accepts `X-API-Key: cwk_...` header or `Authorization: Bearer cwk_...`.
// Stores only sha256(key) in the DB. Does NOT touch existing JWT auth.
const crypto = require('crypto');
const { verifyAccessToken } = require('../lib/auth');
const prisma = require('../lib/prisma');

const KEY_PREFIX = 'cwk_';

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function extractApiKey(req) {
  // X-API-Key header takes precedence
  const headerKey = req.headers['x-api-key'];
  if (headerKey && typeof headerKey === 'string' && headerKey.startsWith(KEY_PREFIX)) {
    return headerKey;
  }
  // Authorization: Bearer cwk_...
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme === 'Bearer' && token && token.startsWith(KEY_PREFIX)) {
    return token;
  }
  return null;
}

// Standalone: API key only.
async function authenticateApiKey(req, res, next) {
  try {
    const raw = extractApiKey(req);
    if (!raw) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    const record = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt < new Date())) {
      return res.status(401).json({ error: { message: 'Invalid or expired API key.' } });
    }
    req.user = {
      type: 'apikey',
      tenantId: record.tenantId,
      scopes: record.scopes || [],
      keyId: record.id,
      role: 'integration', // never matches 'member' scoping or admin roles
    };
    // Fire-and-forget last-used update
    prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return next();
  } catch (err) {
    return next(err);
  }
}

// Combined: tries JWT first (existing behavior), then API key.
// Drop-in replacement for `authenticate` on routes that opt in.
async function authenticateAny(req, res, next) {
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  const isApiKeyStyle =
    (req.headers['x-api-key'] && String(req.headers['x-api-key']).startsWith(KEY_PREFIX)) ||
    (scheme === 'Bearer' && token && token.startsWith(KEY_PREFIX));

  if (isApiKeyStyle) {
    return authenticateApiKey(req, res, next);
  }
  // JWT path — identical to middleware/auth.js
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
  try {
    const payload = verifyAccessToken(token);
    if (!payload || payload.type !== 'access') {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    req.user = payload;
    return next();
  } catch (_err) {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
}

// Scope gate for API-key callers; JWT users pass through untouched.
function requireScope(scope) {
  return (req, res, next) => {
    if (!req.user || req.user.type !== 'apikey') return next();
    const scopes = req.user.scopes || [];
    if (scopes.includes('*') || scopes.includes(scope)) return next();
    return res.status(403).json({ error: { message: `API key lacks required scope: ${scope}` } });
  };
}

module.exports = { authenticateApiKey, authenticateAny, requireScope, hashKey, KEY_PREFIX };
