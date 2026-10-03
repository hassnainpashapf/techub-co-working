// Audit log viewer — immutable, admin only.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

const router = express.Router();

// All routes require authentication + audit.view permission
router.use(authenticate);
router.use(requirePermission('audit.view'));

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const where = {};
    // Tenant isolation: non-super_admin only sees own tenant's logs
    if (req.user.tenantId) {
      where.tenantId = req.user.tenantId;
    }
    if (req.query.entity) where.entity = req.query.entity;
    if (req.query.action) where.action = { contains: req.query.action, mode: 'insensitive' };
    if (req.query.actorId) where.actorId = req.query.actorId;
    // Phase 29: userId alias for actorId (frontend convenience, non-breaking)
    if (req.query.userId) where.actorId = req.query.userId;
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(req.query.from);
      if (req.query.to) where.createdAt.lte = new Date(req.query.to);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return res.json({
      logs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return next(err);
  }
});

// No POST/PUT/DELETE — audit logs are append-only and immutable.

module.exports = router;
