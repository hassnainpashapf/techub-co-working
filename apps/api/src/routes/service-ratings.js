// Phase 55 Track 6/10: Service Ratings (Concierge).
// Mount (coordinator): app.use('/api/service-ratings', require('./routes/service-ratings'));
// server.js / Sidebar.js nahi chhue. Request detail me rating widget — integration note end par.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

function ratingsEnabled() {
  return !!(prisma && prisma.serviceRating && prisma.serviceRequest && prisma.member);
}
function guard503(req, res, next) {
  if (!ratingsEnabled()) return res.status(503).json({ error: 'Service ratings schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'ServiceRating', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

async function myMember(req, tf) {
  if (!req.user.memberId) return null;
  return prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
}

// Aggregate helper — request detail / list me avg rating dikhane ke liye.
async function getRequestRatingSummary(tenantId, requestIds) {
  const rows = await prisma.serviceRating.groupBy({
    by: ['requestId'],
    where: { tenantId, requestId: { in: requestIds } },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const map = {};
  for (const r of rows) {
    map[r.requestId] = { avg: Math.round((r._avg.rating || 0) * 10) / 10, count: r._count.rating };
  }
  return map;
}
module.exports.getRequestRatingSummary = getRequestRatingSummary;

// GET /api/service-ratings/requests/:id — ek request ki rating (member: apni ya staff)
router.get('/requests/:id', async (req, res) => {
  const tf = tenantFilter(req);
  const rating = await prisma.serviceRating.findFirst({
    where: { requestId: req.params.id, ...tf },
    include: { member: { select: { id: true, name: true, email: true } } },
  });
  if (!rating) return res.status(404).json({ error: 'No rating yet' });
  return res.json({ rating });
});

// POST /api/service-ratings/requests/:id/rate — member apni COMPLETED request rate kare (upsert)
router.post(
  '/requests/:id/rate',
  validateBody(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(2000).optional() })),
  async (req, res) => {
    const tf = tenantFilter(req);
    const member = await myMember(req, tf);
    if (!member) return res.status(403).json({ error: 'Only members can rate' });

    const sr = await prisma.serviceRequest.findFirst({
      where: { id: req.params.id, ...tf },
      select: { id: true, memberId: true, status: true },
    });
    if (!sr) return res.status(404).json({ error: 'Service request not found' });
    if (sr.memberId !== member.id) return res.status(403).json({ error: 'You can only rate your own requests' });
    if (sr.status !== 'done') return res.status(422).json({ error: 'Only completed requests can be rated' });

    const rating = await prisma.serviceRating.upsert({
      where: { requestId: sr.id },
      update: { rating: req.body.rating, comment: req.body.comment ?? null },
      create: { tenantId: tf.tenantId, requestId: sr.id, memberId: member.id, rating: req.body.rating, comment: req.body.comment ?? null },
    });
    audit(req, tf, 'service_rating.submit', rating.id, { requestId: sr.id, rating: rating.rating });
    return res.json({ rating });
  }
);

// GET /api/service-ratings — staff: tamam ratings + per-service avg (filters: serviceId, minRating, limit)
router.get('/', requireRole(STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const where = { ...tf };
  if (req.query.minRating) where.rating = { gte: parseInt(req.query.minRating, 10) || 1 };
  if (req.query.serviceId) {
    const match = await prisma.serviceRequest.findMany({
      where: { serviceId: req.query.serviceId, ...tf },
      select: { id: true },
    });
    where.requestId = { in: match.map((m) => m.id) };
  }
  const [items, agg] = await Promise.all([
    prisma.serviceRating.findMany({
      where,
      include: {
        member: { select: { id: true, name: true, email: true } },
        request: { select: { id: true, title: true, serviceId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.serviceRating.aggregate({ where: { ...tf }, _avg: { rating: true }, _count: { rating: true } }),
  ]);
  return res.json({
    items,
    summary: { avg: Math.round(((agg._avg.rating || 0) * 10)) / 10, count: agg._count.rating },
  });
});

// GET /api/service-ratings/services/:id/summary — ek service ki avg rating
router.get('/services/:id/summary', requireRole(STAFF), async (req, res) => {
  const tf = tenantFilter(req);
  const match = await prisma.serviceRequest.findMany({
    where: { serviceId: req.params.id, ...tf },
    select: { id: true },
  });
  const ids = match.map((m) => m.id);
  const summary = ids.length
    ? await prisma.serviceRating.aggregate({ where: { requestId: { in: ids }, ...tf }, _avg: { rating: true }, _count: { rating: true } })
    : { _avg: { rating: null }, _count: { rating: 0 } };
  return res.json({ serviceId: req.params.id, avg: Math.round(((summary._avg.rating || 0) * 10)) / 10, count: summary._count.rating });
});

module.exports = router;
module.exports.getRequestRatingSummary = getRequestRatingSummary;

// === INTEGRATION NOTE (coordinator / Track 2: service-requests UI) ===
// Request detail page me "⭐ Rate service" widget joro:
//   - agar request.status === 'done' aur member ne khud request banayi ho →
//     GET /api/service-ratings/requests/:id (404 = abhi rate nahi hua → star picker dikhao)
//     → submit POST /api/service-ratings/requests/:id/rate {rating, comment?}
//   - request list/detail me avg stars ke liye server side getRequestRatingSummary(tenantId, ids) use karein.
//   - service catalog cards me avg ke liye GET /api/service-ratings/services/:id/summary.
