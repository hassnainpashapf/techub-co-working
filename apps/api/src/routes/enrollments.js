// Phase 53 Track 2: Enrollments & Progress.
// Mount (coordinator): app.use('/api/enrollments', require('./routes/enrollments'));
// NOTE: Course + Lesson models come from Phase 53 Track 1 (fragments/courses.prisma).
//
// Member endpoints (role 'member'):
//   POST /api/enrollments/enroll { courseId }       -> enroll khud (published course me)
//   GET  /api/enrollments/me                        -> meri enrollments + progress
//   GET  /api/enrollments/me/:courseId              -> meri progress + lessons done list
//   POST /api/enrollments/me/lessons/:lessonId/done -> lesson done mark, progress recompute
// Staff endpoints:
//   GET  /api/enrollments?courseId=<id>              -> roster (per course)
//   PATCH /api/enrollments/:id/status               -> status update (staff)
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const MEMBER_ROLES = ['member'];
const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist'];

// Helper: enrollment ka progressPct recompute karo (lessons count vs done count)
async function recomputeProgress(tx, tenantId, enrollment) {
  const total = await tx.lesson.count({
    where: { courseId: enrollment.courseId },
  });
  if (total === 0) return enrollment;
  const done = await tx.lessonProgress.count({
    where: { tenantId, enrollmentId: enrollment.id, isDone: true },
  });
  const pct = Math.round((done / total) * 100);
  const completed = pct >= 100;
  return tx.enrollment.update({
    where: { id: enrollment.id },
    data: {
      progressPct: pct,
      status: completed ? 'completed' : 'active',
      completedAt: completed ? (enrollment.completedAt || new Date()) : enrollment.completedAt,
    },
  });
}

// POST /api/enrollments/enroll — member khud course me enroll ho (published course)
router.post(
  '/enroll',
  requireRole(...MEMBER_ROLES, ...STAFF_ROLES),
  async (req, res, next) => {
    try {
      const { courseId } = z.object({ courseId: z.string().min(1) }).parse(req.body || {});
      const { tenantId } = tenantFilter(req);

      // Staff enroll kar raha hai to body me memberId de sakta hai, warna req.user.memberId
      const memberId = req.body.memberId && STAFF_ROLES.includes(req.user.role)
        ? String(req.body.memberId)
        : req.user.memberId;
      if (!memberId) return res.status(403).json({ error: 'Member account required' });

      const course = await prisma.course.findFirst({
        where: { id: courseId, ...tenantFilter(req) },
        select: { id: true, title: true, isPublished: true },
      });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (!course.isPublished && !STAFF_ROLES.includes(req.user.role)) {
        return res.status(400).json({ error: 'Course is not open for enrollment' });
      }

      const member = await prisma.member.findFirst({
        where: { id: memberId, ...tenantFilter(req) },
        select: { id: true, name: true, status: true },
      });
      if (!member) return res.status(404).json({ error: 'Member not found' });


      const existing = await prisma.enrollment.findFirst({
        where: { tenantId, courseId, memberId },
      });
      if (existing) {
        if (existing.status === 'dropped') {
          const updated = await prisma.enrollment.update({
            where: { id: existing.id },
            data: { status: 'active', completedAt: null },
          });
          return res.json({ enrollment: updated, reactivated: true });
        }
        return res.status(409).json({ error: 'Already enrolled', enrollment: existing });
      }

      const enrollment = await prisma.enrollment.create({
        data: { tenantId, courseId, memberId, status: 'active', progressPct: 0 },
        include: { course: { select: { id: true, title: true } } },
      });

      writeAudit({
        tenantId,
        actorId: req.user.sub,
        action: 'academy.enrolled',
        entity: 'enrollment',
        entityId: enrollment.id,
        newValue: { courseId, memberId },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      }).catch(() => {});

      return res.status(201).json({ enrollment });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /api/enrollments/me — meri enrollments (member)
router.get(
  '/me',
  requireRole(...MEMBER_ROLES, ...STAFF_ROLES),
  async (req, res, next) => {
    try {
      if (!req.user.memberId) return res.status(403).json({ error: 'Member account required' });
      const enrollments = await prisma.enrollment.findMany({
        where: { ...tenantFilter(req), memberId: req.user.memberId },
        include: {
          course: { select: { id: true, title: true, category: true, status: true } },
        },
        orderBy: { enrolledAt: 'desc' },
      });
      return res.json({ enrollments });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /api/enrollments/me/:courseId — meri progress + lessons ka done status
router.get(
  '/me/:courseId',
  requireRole(...MEMBER_ROLES, ...STAFF_ROLES),
  async (req, res, next) => {
    try {
      if (!req.user.memberId) return res.status(403).json({ error: 'Member account required' });
      const enrollment = await prisma.enrollment.findFirst({
        where: {
          ...tenantFilter(req),
          courseId: req.params.courseId,
          memberId: req.user.memberId,
        },
        include: {
          course: { select: { id: true, title: true } },
          lessonProgress: {
            select: { lessonId: true, isDone: true, doneAt: true },
          },
        },
      });
      if (!enrollment) return res.status(404).json({ error: 'Not enrolled' });
      return res.json({ enrollment });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /api/enrollments/me/lessons/:lessonId/done — lesson done mark (toggle)
router.post(
  '/me/lessons/:lessonId/done',
  requireRole(...MEMBER_ROLES, ...STAFF_ROLES),
  async (req, res, next) => {
    try {
      const { done } = z.object({ done: z.boolean().default(true) }).parse(req.body || {});
      if (!req.user.memberId) return res.status(403).json({ error: 'Member account required' });
      const { tenantId } = tenantFilter(req);

      const lesson = await prisma.lesson.findFirst({
        where: { id: req.params.lessonId, ...tenantFilter(req) },
        select: { id: true, courseId: true },
      });
      if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

      const enrollment = await prisma.enrollment.findFirst({
        where: { tenantId, courseId: lesson.courseId, memberId: req.user.memberId },
      });
      if (!enrollment) return res.status(404).json({ error: 'Not enrolled in this course' });

      const progress = await prisma.$transaction(async (tx) => {
        await tx.lessonProgress.upsert({
          where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
          update: { isDone: done, doneAt: done ? new Date() : null, tenantId },
          create: {
            tenantId,
            enrollmentId: enrollment.id,
            lessonId: lesson.id,
            isDone: done,
            doneAt: done ? new Date() : null,
          },
        });
        return recomputeProgress(tx, tenantId, enrollment);
      });

      writeAudit({
        tenantId,
        actorId: req.user.sub,
        action: 'academy.lesson_done',
        entity: 'lessonProgress',
        entityId: progress.id,
        newValue: { enrollmentId: enrollment.id, lessonId: lesson.id, done, progressPct: progress.progressPct },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      }).catch(() => {});

      return res.json({ enrollment: progress });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /api/enrollments — roster per course (staff)
router.get(
  '/',
  requireRole(...STAFF_ROLES),
  async (req, res, next) => {
    try {
      const { courseId, status } = req.query;
      const where = { ...tenantFilter(req) };
      if (courseId) where.courseId = String(courseId);
      if (status) where.status = String(status);
      const enrollments = await prisma.enrollment.findMany({
        where,
        include: {
          member: { select: { id: true, name: true, email: true } },
          course: { select: { id: true, title: true } },
        },
        orderBy: { enrolledAt: 'desc' },
        take: 500,
      });
      const counts = await prisma.enrollment.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      });
      return res.json({ enrollments, counts });
    } catch (err) {
      return next(err);
    }
  }
);

// PATCH /api/enrollments/:id/status — enrollment status update (staff)
router.patch(
  '/:id/status',
  requireRole(...STAFF_ROLES),
  async (req, res, next) => {
    try {
      const { status } = z.object({
        status: z.enum(['active', 'completed', 'dropped']),
      }).parse(req.body || {});
      const { tenantId } = tenantFilter(req);
      const enrollment = await prisma.enrollment.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

      const updated = await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          status,
          progressPct: status === 'completed' ? 100 : enrollment.progressPct,
          completedAt: status === 'completed' ? (enrollment.completedAt || new Date()) : enrollment.completedAt,
        },
        include: {
          member: { select: { id: true, name: true } },
          course: { select: { id: true, title: true } },
        },
      });

      writeAudit({
        tenantId,
        actorId: req.user.sub,
        action: 'academy.enrollment_status',
        entity: 'enrollment',
        entityId: enrollment.id,
        oldValue: { status: enrollment.status },
        newValue: { status },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      }).catch(() => {});

      return res.json({ enrollment: updated });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
