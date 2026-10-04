// Phase 53 Track 7/10: Course Ratings & Reviews.
// Mount (coordinator): app.use('/api/course-ratings', require('./routes/course-ratings').router);
// server.js / Sidebar.js nahi chhue.
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

function ratingsEnabled() {
  return !!(prisma && prisma.courseRating && prisma.course && prisma.enrollment);
}
function guard503(req, res, next) {
  if (!ratingsEnabled()) return res.status(503).json({ error: 'Course ratings schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'CourseRating', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

async function resolveMember(req, tf) {
  if (!req.user.memberId) return null;
  return prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
}

// Aggregate helper — coordinator Track 1 ke course list me join kar sakta hai
// (har course card par avg stars dikhane ke liye).
async function getCourseRatingSummary(tenantId, courseIds) {
  const rows = await prisma.courseRating.groupBy({
    by: ['courseId'],
    where: { tenantId, courseId: { in: courseIds } },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const map = {};
  for (const r of rows) {
    map[r.courseId] = { avg: Math.round((r._avg.rating || 0) * 10) / 10, count: r._count.rating };
  }
  return map;
}
module.exports.getCourseRatingSummary = getCourseRatingSummary;

// POST /api/course-ratings/courses/:id/rate — member course rate kare (sirf enrolled; upsert = dobara rate = update)
router.post(
  '/courses/:id/rate',
  validateBody(z.object({ rating: z.number().int().min(1).max(5), review: z.string().max(2000).optional() })),
  async (req, res) => {
    try {
      const tf = tenantFilter(req);
      const member = await resolveMember(req, tf);
      if (!member) return res.status(403).json({ error: 'Member account required to rate courses' });

      const course = await prisma.course.findFirst({ where: { id: req.params.id, ...tf } });
      if (!course) return res.status(404).json({ error: 'Course not found' });

      const enrollment = await prisma.enrollment.findFirst({
        where: { tenantId: tf.tenantId, courseId: course.id, memberId: member.id },
      });
      if (!enrollment) return res.status(403).json({ error: 'Only enrolled members can rate this course' });

      const rating = await prisma.courseRating.upsert({
        where: { courseId_memberId: { courseId: course.id, memberId: member.id } },
        update: { rating: req.body.rating, review: req.body.review ?? null },
        create: {
          tenantId: tf.tenantId, courseId: course.id, memberId: member.id,
          rating: req.body.rating, review: req.body.review ?? null,
        },
      });
      audit(req, tf, 'course_rating.rate', rating.id, { courseId: course.id, rating: rating.rating });
      res.json({ ok: true, rating });
    } catch (e) {
      console.error('course-rating rate failed', e);
      res.status(500).json({ error: 'Rating save failed' });
    }
  }
);

// GET /api/course-ratings/courses/:id/ratings — avg + count + distribution + recent reviews + meri rating
router.get('/courses/:id/ratings', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const course = await prisma.course.findFirst({ where: { id: req.params.id, ...tf } });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const agg = await prisma.courseRating.aggregate({
      where: { tenantId: tf.tenantId, courseId: course.id },
      _avg: { rating: true }, _count: { rating: true },
    });
    const dist = await prisma.courseRating.groupBy({
      by: ['rating'], where: { tenantId: tf.tenantId, courseId: course.id }, _count: { rating: true },
    });
    const reviews = await prisma.courseRating.findMany({
      where: { tenantId: tf.tenantId, courseId: course.id },
      include: { member: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
    let myRating = null;
    if (req.user.memberId) {
      myRating = await prisma.courseRating.findUnique({
        where: { courseId_memberId: { courseId: course.id, memberId: req.user.memberId } },
      });
    }
    res.json({
      avg: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0,
      count: agg._count.rating,
      distribution: dist.map(d => ({ rating: d.rating, count: d._count.rating })),
      reviews: reviews.map(r => ({ id: r.id, rating: r.rating, review: r.review, createdAt: r.createdAt, memberName: r.member?.name })),
      myRating,
    });
  } catch (e) {
    console.error('course-rating ratings failed', e);
    res.status(500).json({ error: 'Failed to load ratings' });
  }
});

// DELETE /api/course-ratings/courses/:id/rate — apni rating delete kare
router.delete('/courses/:id/rate', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const member = await resolveMember(req, tf);
    if (!member) return res.status(403).json({ error: 'Member account required' });
    const existing = await prisma.courseRating.findUnique({
      where: { courseId_memberId: { courseId: req.params.id, memberId: member.id } },
    });
    if (!existing) return res.status(404).json({ error: 'Rating not found' });
    await prisma.courseRating.delete({ where: { id: existing.id } });
    audit(req, tf, 'course_rating.delete', existing.id, { courseId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    console.error('course-rating delete failed', e);
    res.status(500).json({ error: 'Rating delete failed' });
  }
});

// GET /api/course-ratings/staff — staff: tamam ratings, avg ke sath (filter: courseId, minRating)
// Staff-only: admin / manager / reception (+ super_admin bypass).
router.get('/staff', requireRole('ceo', 'admin', 'manager', 'reception'), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.courseId) where.courseId = String(req.query.courseId);
    if (req.query.minRating) where.rating = { gte: Math.min(Math.max(parseInt(req.query.minRating, 10) || 1, 1), 5) };
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);

    const ratings = await prisma.courseRating.findMany({
      where,
      include: {
        course: { select: { id: true, title: true, slug: true } },
        member: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' }, take: limit,
    });

    const courseIds = [...new Set(ratings.map(r => r.courseId))];
    const summary = await getCourseRatingSummary(tf.tenantId, courseIds);

    res.json({
      ratings,
      summary,
    });
  } catch (e) {
    console.error('course-rating staff list failed', e);
    res.status(500).json({ error: 'Failed to load ratings' });
  }
});

// GET /api/course-ratings/courses/:id/summary — sirf {avg, count} (course cards ke liye halka endpoint)
router.get('/courses/:id/summary', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const course = await prisma.course.findFirst({ where: { id: req.params.id, ...tf } });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const agg = await prisma.courseRating.aggregate({
      where: { tenantId: tf.tenantId, courseId: course.id },
      _avg: { rating: true }, _count: { rating: true },
    });
    res.json({
      avg: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0,
      count: agg._count.rating,
    });
  } catch (e) {
    console.error('course-rating summary failed', e);
    res.status(500).json({ error: 'Failed to load rating summary' });
  }
});

module.exports.router = router;
