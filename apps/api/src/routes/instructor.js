// Phase 53 Track 9/10: Instructor Dashboard — instructor apni courses ka
// enrollment/ratings/completion dekhe; roster me students + progress + quiz scores.
// Coordinator ke liye:
//   Mount: app.use('/api/instructor', require('./routes/instructor'));
//   Sidebar note: academy courses page me instructor view — 'Academy' page ke andar
//   tab/section (Sidebar me naya top-level link NAHI).
// Access: instructor = course.instructorId === req.user.id, ya staff role
// (ceo/admin/super_admin/manager) — staff sab courses dekh sakta hai.
// Koi migration nahi (Course/Enrollment/Quiz models Track 1-3 se).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

function academyOr503(res) {
  if (!prisma.course || !prisma.enrollment || !prisma.quiz || !prisma.quizAttempt || !prisma.courseRating) {
    res.status(503).json({ error: 'Academy module abhi migrate nahi hua.' });
    return false;
  }
  return true;
}

const isStaff = (req) => STAFF.includes(req.user.role);

// Instructor apni courses dekh sakta hai; staff ko sab.
function courseScope(req) {
  const tf = tenantFilter(req);
  if (isStaff(req)) return tf;
  return { ...tf, instructorId: req.user.id };
}

router.use(authenticate, requireTenantUser, requireRole(...STAFF, 'member'));

// ---------- GET /api/instructor/my-courses ----------
// Har course ke sath: enrollments count, avg rating, completion rate.
router.get('/my-courses', async (req, res, next) => {
  try {
    if (!academyOr503(res)) return;
    const scope = courseScope(req);

    const courses = await prisma.course.findMany({
      where: scope,
      include: { instructor: { select: { id: true, name: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    const result = await Promise.all(
      courses.map(async (c) => {
        const tf = tenantFilter(req);
        const [enrollments, ratingAgg, completed] = await Promise.all([
          prisma.enrollment.count({ where: { ...tf, courseId: c.id } }),
          prisma.courseRating.aggregate({
            where: { ...tf, courseId: c.id },
            _avg: { rating: true },
            _count: { rating: true },
          }),
          prisma.enrollment.count({ where: { ...tf, courseId: c.id, status: 'completed' } }),
        ]);
        return {
          id: c.id,
          title: c.title,
          slug: c.slug,
          category: c.category,
          level: c.level,
          isPublished: c.isPublished,
          price: c.price,
          instructor: c.instructor,
          enrollments,
          avgRating: ratingAgg._avg.rating !== null ? Number(ratingAgg._avg.rating.toFixed(1)) : null,
          ratingsCount: ratingAgg._count.rating,
          completionRate: enrollments > 0 ? Math.round((completed / enrollments) * 100) : 0,
          completedCount: completed,
        };
      })
    );

    res.json({ courses: result });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/instructor/course/:id/roster ----------
// Students + progress + quiz scores (latest attempt per quiz).
router.get('/course/:id/roster', async (req, res, next) => {
  try {
    if (!academyOr503(res)) return;
    const tf = tenantFilter(req);

    const course = await prisma.course.findFirst({
      where: { ...tf, id: req.params.id },
      select: { id: true, title: true, instructorId: true },
    });
    if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
    // Ownership check: instructor sirf apni course ka roster dekh sakta hai.
    if (!isStaff(req) && course.instructorId !== req.user.id) {
      return res.status(403).json({ error: 'Aap is course ke instructor nahi hain.' });
    }

    const [enrollments, lessons] = await Promise.all([
      prisma.enrollment.findMany({
        where: { ...tf, courseId: course.id },
        include: { member: { select: { id: true, name: true, email: true, phone: true, status: true } } },
        orderBy: { enrolledAt: 'asc' },
      }),
      prisma.lesson.findMany({
        where: { courseId: course.id },
        select: { id: true },
      }),
    ]);

    // Course ki lessons ke quizzes + sab attempts (latest attempt per member per quiz).
    const lessonIds = lessons.map((l) => l.id);
    const quizzes = await prisma.quiz.findMany({
      where: { ...tf, lessonId: { in: lessonIds } },
      select: { id: true, title: true, passingPct: true },
    });
    const quizIds = quizzes.map((q) => q.id);
    const attempts = quizIds.length
      ? await prisma.quizAttempt.findMany({
          where: { ...tf, quizId: { in: quizIds } },
          orderBy: { attemptedAt: 'desc' },
        })
      : [];

    // latest attempt per (memberId, quizId)
    const latestByKey = new Map();
    for (const a of attempts) {
      const key = `${a.memberId}:${a.quizId}`;
      if (!latestByKey.has(key)) latestByKey.set(key, a);
    }

    const roster = enrollments.map((e) => {
      const quizScores = quizzes.map((q) => {
        const a = latestByKey.get(`${e.memberId}:${q.id}`);
        return {
          quizId: q.id,
          quizTitle: q.title,
          attempted: !!a,
          score: a ? a.score : null,
          passed: a ? a.passed : null,
          attemptedAt: a ? a.attemptedAt : null,
        };
      });
      const attemptedQuizzes = quizScores.filter((q) => q.attempted);
      return {
        member: e.member,
        status: e.status,
        progressPct: e.progressPct,
        enrolledAt: e.enrolledAt,
        completedAt: e.completedAt,
        quizScores,
        avgQuizScore: attemptedQuizzes.length
          ? Number((attemptedQuizzes.reduce((s, q) => s + q.score, 0) / attemptedQuizzes.length).toFixed(1))
          : null,
      };
    });

    const totalEnrollments = enrollments.length;
    const avgProgress = totalEnrollments
      ? Math.round(enrollments.reduce((s, e) => s + e.progressPct, 0) / totalEnrollments)
      : 0;

    res.json({
      course: { id: course.id, title: course.title },
      summary: {
        totalStudents: totalEnrollments,
        completed: enrollments.filter((e) => e.status === 'completed').length,
        active: enrollments.filter((e) => e.status === 'active').length,
        dropped: enrollments.filter((e) => e.status === 'dropped').length,
        avgProgressPct: avgProgress,
        quizzesCount: quizzes.length,
      },
      roster,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/instructor/course/:id/quiz-stats ----------
// Bonus: har quiz ki performance summary (attempts, avg score, pass rate).
router.get('/course/:id/quiz-stats', async (req, res, next) => {
  try {
    if (!academyOr503(res)) return;
    const tf = tenantFilter(req);

    const course = await prisma.course.findFirst({
      where: { ...tf, id: req.params.id },
      select: { id: true, title: true, instructorId: true },
    });
    if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
    if (!isStaff(req) && course.instructorId !== req.user.id) {
      return res.status(403).json({ error: 'Aap is course ke instructor nahi hain.' });
    }

    const lessons = await prisma.lesson.findMany({
      where: { courseId: course.id },
      select: { id: true, title: true },
    });
    const lessonIds = lessons.map((l) => l.id);
    const quizzes = await prisma.quiz.findMany({
      where: { ...tf, lessonId: { in: lessonIds } },
      select: { id: true, title: true, lessonId: true, passingPct: true },
    });
    const attempts = quizzes.length
      ? await prisma.quizAttempt.findMany({
          where: { ...tf, quizId: { in: quizzes.map((q) => q.id) } },
          select: { quizId: true, memberId: true, score: true, passed: true },
        })
      : [];

    const quizStats = quizzes.map((q) => {
      const qa = attempts.filter((a) => a.quizId === q.id);
      const uniqueStudents = new Set(qa.map((a) => a.memberId)).size;
      const avgScore = qa.length ? Number((qa.reduce((s, a) => s + a.score, 0) / qa.length).toFixed(1)) : null;
      const passed = qa.filter((a) => a.passed).length;
      return {
        quizId: q.id,
        quizTitle: q.title,
        lessonId: q.lessonId,
        passingPct: q.passingPct,
        attempts: qa.length,
        uniqueStudents,
        avgScore,
        passRate: qa.length ? Math.round((passed / qa.length) * 100) : 0,
      };
    });

    res.json({ course: { id: course.id, title: course.title }, quizzes: quizStats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
