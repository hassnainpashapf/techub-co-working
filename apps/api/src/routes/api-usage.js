// Phase 36: API usage analytics (ceo/admin only).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const ADMIN_ROLES = ['ceo', 'admin', 'super_admin'];
const adminOnly = requireRole(...ADMIN_ROLES);

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

// GET /api/api-usage?days=7 — dashboard aggregates
router.get('/', adminOnly, async (req, res, next) => {
  try {
    if (!prisma.apiUsageLog) {
      return res.status(503).json({ error: { message: 'API usage tracking not yet available.' } });
    }
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const logs = await prisma.apiUsageLog.findMany({
      where: { ...tenantFilter(req), createdAt: { gte: since } },
      select: { endpoint: true, method: true, statusCode: true, durationMs: true, apiKeyId: true, createdAt: true },
    });

    const perDay = {};
    for (let i = 0; i < days; i++) {
      perDay[dayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000))] = 0;
    }
    const endpoints = {};
    const keys = {};
    let errors = 0;
    let totalMs = 0;

    for (const l of logs) {
      perDay[dayKey(l.createdAt)] = (perDay[dayKey(l.createdAt)] || 0) + 1;
      const ek = `${l.method} ${l.endpoint}`;
      const e = (endpoints[ek] = endpoints[ek] || { endpoint: l.endpoint, method: l.method, requests: 0, errors: 0, totalMs: 0 });
      e.requests += 1;
      e.totalMs += l.durationMs || 0;
      if (l.statusCode >= 400) {
        e.errors += 1;
        errors += 1;
      }
      totalMs += l.durationMs || 0;
      if (l.apiKeyId) {
        const k = (keys[l.apiKeyId] = keys[l.apiKeyId] || { apiKeyId: l.apiKeyId, requests: 0, errors: 0 });
        k.requests += 1;
        if (l.statusCode >= 400) k.errors += 1;
      }
    }

    const topEndpoints = Object.values(endpoints)
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 15)
      .map((e) => ({ ...e, avgMs: e.requests ? Math.round(e.totalMs / e.requests) : 0, totalMs: undefined }));

    const keyIds = Object.keys(keys);
    let keyMeta = {};
    if (keyIds.length) {
      const rows = await prisma.apiKey.findMany({
        where: { id: { in: keyIds }, ...tenantFilter(req) },
        select: { id: true, name: true, keyPrefix: true, rateLimitPerMin: true, revokedAt: true },
      });
      keyMeta = Object.fromEntries(rows.map((r) => [r.id, r]));
    }
    const topKeys = Object.values(keys)
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 15)
      .map((k) => ({
        ...k,
        name: keyMeta[k.apiKeyId]?.name || '(deleted key)',
        keyPrefix: keyMeta[k.apiKeyId]?.keyPrefix || '',
        rateLimitPerMin: keyMeta[k.apiKeyId]?.rateLimitPerMin ?? null,
        revoked: !!keyMeta[k.apiKeyId]?.revokedAt,
      }));

    const total = logs.length;
    res.json({
      days,
      total,
      errorRate: total ? +(errors / total * 100).toFixed(1) : 0,
      avgLatencyMs: total ? Math.round(totalMs / total) : 0,
      activeKeys: keyIds.length,
      perDay: Object.entries(perDay)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, requests]) => ({ date, requests })),
      topEndpoints,
      topKeys,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
