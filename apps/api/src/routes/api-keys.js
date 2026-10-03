// Phase 24: API key management (JWT auth, ceo/admin only).
// The full key is returned ONCE at creation; only keyHash is stored.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { hashKey, KEY_PREFIX } = require('../middleware/apiKey');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const ADMIN_ROLES = ['ceo', 'admin', 'super_admin'];
const adminOnly = requireRole(...ADMIN_ROLES);

const AVAILABLE_SCOPES = [
  'bookings:read',
  'members:read',
  'units:read',
  'invoices:read',
  '*',
];

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1).refine(
    (s) => s.every((x) => AVAILABLE_SCOPES.includes(x)),
    { message: 'Invalid scope' }
  ),
  expiresInDays: z.number().int().min(1).max(3650).optional().nullable(),
});

function safeKey(k) {
  return {
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    scopes: k.scopes,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
    status: k.revokedAt ? 'revoked' : (k.expiresAt && k.expiresAt < new Date() ? 'expired' : 'active'),
  };
}

// List keys (never the full secret)
router.get('/', adminOnly, async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { ...tenantFilter(req) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ apiKeys: keys.map(safeKey), availableScopes: AVAILABLE_SCOPES });
  } catch (e) { next(e); }
});

// Create key — returns the FULL key once
router.post('/', adminOnly, validateBody(createSchema), async (req, res, next) => {
  try {
    const raw = KEY_PREFIX + crypto.randomBytes(32).toString('hex');
    const key = await prisma.apiKey.create({
      data: {
        tenantId: req.user.tenantId,
        name: req.body.name,
        keyHash: hashKey(raw),
        keyPrefix: raw.slice(KEY_PREFIX.length, KEY_PREFIX.length + 8),
        scopes: req.body.scopes,
        expiresAt: req.body.expiresInDays
          ? new Date(Date.now() + req.body.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
        createdBy: req.user.sub,
      },
    });
    await writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'apikey.created',
      entity: 'ApiKey',
      entityId: key.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(201).json({ apiKey: safeKey(key), key: raw });
  } catch (e) { next(e); }
});

// Revoke key
router.delete('/:id', adminOnly, async (req, res, next) => {
  try {
    const key = await prisma.apiKey.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!key) return res.status(404).json({ error: { message: 'API key not found.' } });
    const updated = await prisma.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });
    await writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'apikey.revoked',
      entity: 'ApiKey',
      entityId: key.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ apiKey: safeKey(updated) });
  } catch (e) { next(e); }
});

module.exports = router;
