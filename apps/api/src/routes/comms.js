// Phase 49 Track 1/10: Unified Communication Hub — unified inbox API.
// Mount: app.use('/api/comms', require('./routes/comms'));
// Sidebar: Communication section me { label: 'Inbox', path: '/comms' }
// (roles: ceo/admin/super_admin/manager/receptionist/ops)
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { CHANNELS, STATUSES, hasModel, sendViaChannel, updateStatus } = require('../lib/comms');

const router = express.Router();

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops'];

// Migration merge se pehle safe 503 (koi 500 crash nahi)
function needMigration(req, res, next) {
  if (!hasModel()) {
    return res.status(503).json({ error: 'comm_messages migration pending — deploy ke baad available' });
  }
  next();
}

const sendSchema = z.object({
  channel: z.enum(CHANNELS),
  memberId: z.string().min(1).max(64).optional().nullable(),
  to: z.string().max(200).optional().nullable(),
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(4000),
  template: z.string().max(100).optional().nullable(), // whatsapp template
  scheduledFor: z.string().datetime().optional().nullable(),
});

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'CommMessage',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

// Phase 49: bulk schedule (Track 7) — POST /api/comms/schedule {channel, memberIds, body, scheduledFor}
const scheduleSchema = z.object({
  channel: z.enum(CHANNELS),
  memberIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(4000),
  scheduledFor: z.string().datetime(),
});

router.post(
  '/schedule',
  authenticate,
  requireTenantUser,
  requireRole(...STAFF),
  validateBody(scheduleSchema),
  needMigration,
  async (req, res, next) => {
    try {
      const tenantId = req.user.tenantId;
      const { channel, memberIds, subject, body, scheduledFor } = req.body;
      const { scheduleMessage } = require('../lib/scheduledComms');
      const result = await scheduleMessage({
        tenantId,
        channel,
        memberIds,
        body,
        subject: subject || null,
        scheduledFor: new Date(scheduledFor),
        userId: req.user.sub,
      });
      await audit(req, 'comms.schedule', null, { channel, count: result.scheduled, scheduledFor });
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

// GET /api/comms — unified history (filters: memberId, channel, direction, status, search, from, to, page, limit)
router.get(
  '/',
  authenticate,
  requireTenantUser,
  requireRole(...STAFF),
  needMigration,
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const { memberId, channel, direction, status, search, from, to } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

      const where = { ...tf };
      if (memberId) where.memberId = String(memberId);
      if (channel && CHANNELS.includes(channel)) where.channel = channel;
      if (direction && ['in', 'out'].includes(direction)) where.direction = direction;
      if (status && STATUSES.includes(status)) where.status = status;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(String(from));
        if (to) where.createdAt.lte = new Date(String(to));
      }
      if (search) {
        const q = String(search);
        where.OR = [
          { body: { contains: q, mode: 'insensitive' } },
          { subject: { contains: q, mode: 'insensitive' } },
          { to: { contains: q, mode: 'insensitive' } },
          { member: { name: { contains: q, mode: 'insensitive' } } },
        ];
      }

      const [total, rows] = await Promise.all([
        prisma.commMessage.count({ where }),
        prisma.commMessage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            member: { select: { id: true, name: true, email: true, phone: true } },
            user: { select: { id: true, name: true } },
          },
        }),
      ]);

      res.json({ total, page, pages: Math.ceil(total / limit), messages: rows });
    } catch (e) {
      next(e);
    }
  }
);

// GET /api/comms/summary — inbox counts (unread-ish per channel)
router.get(
  '/summary',
  authenticate,
  requireTenantUser,
  requireRole(...STAFF),
  needMigration,
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const [queued, failed, byChannel] = await Promise.all([
        prisma.commMessage.count({ where: { ...tf, status: 'queued' } }),
        prisma.commMessage.count({ where: { ...tf, status: 'failed' } }),
        prisma.commMessage.groupBy({
          by: ['channel'],
          where: tf,
          _count: { id: true },
        }),
      ]);
      res.json({
        queued,
        failed,
        byChannel: byChannel.map((r) => ({ channel: r.channel, count: r._count.id })),
      });
    } catch (e) {
      next(e);
    }
  }
);

// POST /api/comms/send — channel select karke bheje (scheduledFor ho to queued rakhe)
router.post(
  '/send',
  authenticate,
  requireTenantUser,
  requireRole(...STAFF),
  validateBody(sendSchema),
  needMigration,
  async (req, res, next) => {
    try {
      const tenantId = req.user.tenantId;
      const { channel, memberId, to, subject, body, template, scheduledFor } = req.body;

      // member tenant-scoped check
      if (memberId) {
        const m = await prisma.member.findFirst({
          where: { id: memberId, tenantId },
          select: { id: true },
        });
        if (!m) return res.status(404).json({ error: 'member not found in this tenant' });
      }

      const result = await sendViaChannel(tenantId, {
        channel,
        memberId: memberId || null,
        userId: req.user.sub,
        to: to || null,
        subject: subject || null,
        body,
        template: template || null,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      });

      await audit(req, 'comms.send', result.row ? result.row.id : null, {
        channel,
        memberId: memberId || null,
        sent: result.sent,
        provider: result.provider,
      });

      res.status(result.sent ? 201 : 202).json({
        sent: result.sent,
        queued: result.queued || false,
        provider: result.provider,
        messageId: result.row ? result.row.id : null,
        error: result.error || null,
      });
    } catch (e) {
      next(e);
    }
  }
);

// PATCH /api/comms/:id — manual status update (voice call confirm waghera)
router.patch(
  '/:id',
  authenticate,
  requireTenantUser,
  requireRole(...STAFF),
  needMigration,
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const { status } = req.body || {};
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
      }
      const row = await prisma.commMessage.findFirst({
        where: { id: req.params.id, ...tf },
      });
      if (!row) return res.status(404).json({ error: 'message not found' });
      await updateStatus(row.id, { status });
      await audit(req, 'comms.status', row.id, { status });
      res.json({ ok: true, status });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
