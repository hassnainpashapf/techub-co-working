// Phase 53 Track 10/10: Academy Dashboard — aggregate stats + popular courses.
// Sare sections defensive hain: parallel tracks (1-9) ke models merge na hue hon
// to wo section 0/empty deta hai, poora dashboard 503 nahi hota.
// Koi migration nahi — sirf tracks 1-9 ke models se compute hota hai.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

// Model merge hua ya nahi (schema merge se pehle prisma.<model> undefined hota hai).
// Enrollment model ka naam track 2 ne jo final kiya (enrollment/courseEnrollment), dono support karo.
function m(name) {
  return prisma[name] || null;
}

const toNum = (d) => (d === null || d === undefined ? 0 : Number(d));

// GET /api/academy-dashboard/stats — academy ke key numbers + popular courses.
router.get('/stats', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const stats = {
      publishedCourses: 0,
      activeEnrollments: 0,
      completions30d: 0,
      avgRating: 0,
      ratingCount: 0,
      certificatesIssued: 0,
      upcomingWorkshops: 0,
    };
    const modules = {};
    let popularCourses = [];

    // --- Courses (track 1) ---
    const CO = m('course');
    if (CO) {
      modules.courses = true;
      stats.publishedCourses = await CO.count({
        where: { tenantId, isPublished: true },
      });
    }

    // --- Enrollments (track 2) ---
    const EN = m('enrollment');
    if (EN) {
      modules.enrollments = true;
      stats.activeEnrollments = await EN.count({
        where: { tenantId, status: 'active' },
      });
      stats.completions30d = await EN.count({
        where: { tenantId, status: 'completed', completedAt: { gte: d30 } },
      });

      // Popular courses: sab se zyada enrollments
      if (CO) {
        const top = await EN.groupBy({
          by: ['courseId'],
          where: { tenantId, courseId: { not: null } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 5,
        });
        if (top.length) {
          const ids = top.map((t) => t.courseId);
          const courses = await CO.findMany({
            where: { tenantId, id: { in: ids } },
            select: { id: true, title: true, category: true, level: true },
          });
          const cMap = Object.fromEntries(courses.map((c) => [c.id, c]));
          popularCourses = top
            .filter((t) => cMap[t.courseId])
            .map((t) => ({
              id: t.courseId,
              title: cMap[t.courseId].title,
              category: cMap[t.courseId].category,
              level: cMap[t.courseId].level,
              enrollments: t._count.id,
            }));
        }
      }
    }

    // --- Ratings (track 7) ---
    const RT = m('courseRating');
    if (RT) {
      modules.ratings = true;
      const agg = await RT.aggregate({
        where: { tenantId },
        _avg: { rating: true },
        _count: { id: true },
      });
      stats.avgRating = toNum(agg._avg.rating);
      stats.ratingCount = agg._count.id || 0;
    }

    // --- Certificates (track 4) ---
    const CT = m('certificate');
    if (CT) {
      modules.certificates = true;
      stats.certificatesIssued = await CT.count({ where: { tenantId } });
    }

    // --- Workshops (track 6) ---
    const WS = m('workshop');
    if (WS) {
      modules.workshops = true;
      stats.upcomingWorkshops = await WS.count({
        where: { tenantId, scheduledAt: { gte: now }, status: 'scheduled' },
      });
    }

    return res.json({ stats, popularCourses, modules });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
