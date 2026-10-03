// Phase 29: Member Feedback System.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

const CATEGORIES = ['facility', 'service', 'staff', 'cleanliness', 'other'];
const STATUSES = ['new', 'reviewed', 'resolved'];

// Resolve the member record for the logged-in user (memberId from JWT, fallback to email).
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

const createSchema = z.object({
  category: z.enum(CATEGORIES).optional().default('other'),
  rating: z.number().int().min(1).max(5),
  message: z.string().min(1).max(5000),
});

// POST /api/feedback — member submits feedback (linked to own member record)
router.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    const { category, rating, message } = req.body;
    const fb = await prisma.feedback.create({
      data: { tenantId: tf.tenantId, memberId: member.id, category, rating, message, status: 'new' },
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'feedback.create',
      entity: 'Feedback', entityId: fb.id, newValue: { category, rating },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.status(201).json({ feedback: fb });
  } catch (err) {
    return next(err);
  }
});

// GET /api/feedback/mine — my feedback list
router.get('/mine', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    const items = await prisma.feedback.findMany({
      where: { memberId: member.id, ...tf },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ items });
  } catch (err) {
    return next(err);
  }
});

// GET /api/feedback — staff list with filters + avg rating summary
router.get('/', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.status && STATUSES.includes(req.query.status)) where.status = req.query.status;
    if (req.query.category && CATEGORIES.includes(req.query.category)) where.category = req.query.category;
    const [items, agg] = await Promise.all([
      prisma.feedback.findMany({
        where,
        include: { member: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.feedback.aggregate({
        where,
        _avg: { rating: true },
        _count: { id: true },
      }),
    ]);
    return res.json({
      items,
      summary: {
        avgRating: agg._avg.rating ? Number(agg._avg.rating.toFixed(2)) : null,
        total: agg._count.id,
      },
    });
  } catch (err) {
    return next(err);
  }
});

const patchSchema = z.object({
  status: z.enum(STATUSES).optional(),
  adminReply: z.string().max(5000).nullable().optional(),
});

// PATCH /api/feedback/:id — staff updates status / replies; member gets in-app notification
router.patch('/:id', staffOnly, validateBody(patchSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.feedback.findFirst({
      where: { id: req.params.id, ...tf },
      include: { member: { select: { id: true, name: true } } },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Feedback not found.' } });
    const data = {};
    if (req.body.status) data.status = req.body.status;
    if (req.body.adminReply !== undefined) data.adminReply = req.body.adminReply;
    const fb = await prisma.feedback.update({ where: { id: existing.id }, data });

    // Notify the member's login (if any) via in-app notification
    try {
      const user = await prisma.user.findFirst({
        where: { memberId: existing.memberId, tenantId: tf.tenantId, isActive: true },
        select: { id: true },
      });
      if (user) {
        await prisma.notification.create({
          data: {
            tenantId: tf.tenantId,
            userId: user.id,
            type: 'general',
            message: req.body.adminReply
              ? `💬 Reply to your feedback: ${req.body.adminReply.slice(0, 140)}`
              : `✅ Your feedback is now ${fb.status}.`,
          },
        });
      }
    } catch { /* notification best-effort */ }

    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'feedback.update',
      entity: 'Feedback', entityId: fb.id, newValue: data,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ feedback: fb });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
