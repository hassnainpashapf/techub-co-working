// Phase 53 Track 8/10: Learning Paths API.
// Mount: server.js me  app.use('/api/learning-paths', require('./routes/learning-paths'));
// Staff CRUD; members: published paths ki list + apni progress.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const READ_ROLES = [
  'super_admin',
  'ceo',
  'admin',
  'operations_manager',
  'manager',
  'finance_officer',
  'receptionist',
  'office_boy',
  'member',
];
const WRITE_ROLES = ['ceo', 'admin', 'operations_manager', 'manager'];
const write = requireRole(...WRITE_ROLES);

const pathSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  courseIds: z.array(z.string().min(1)).default([]),
  isPublished: z.boolean().default(false),
});
const pathUpdateSchema = pathSchema.partial().refine((d) => Object.keys(d).length > 0, {
  message: 'No fields to update',
});

const STAFF_ROLES = new Set(['super_admin', 'ceo', 'admin', 'operations_manager', 'manager']);

// Track 2 ke Enrollment model se completed course ids nikalo.
// Enrollment.status === 'completed' => course complete. (Track 2 fragment se.)
async function completedCourseIds(req, memberId) {
  const tf = tenantFilter(req);
  try {
    const rows = await prisma.enrollment.findMany({
      where: { ...tf, memberId, status: 'completed' },
      select: { courseId: true },
    });
    return new Set(rows.map((r) => r.courseId));
  } catch (err) {
    // Model merge nahi hua ya memberId alag field me — progress 0 treat karo.
    if (process.env.NODE_ENV !== 'test') console.warn('[learning-paths] progress lookup failed:', err.message);
    return new Set();
  }
}

function withProgress(path, completed, courseMeta = {}) {
  const ids = Array.isArray(path.courseIds) ? path.courseIds : [];
  const total = ids.length;
  const done = ids.filter((id) => completed.has(id));
  const courses = ids.map((id) => ({
    id,
    completed: completed.has(id),
    ...(courseMeta[id] || {}),
  }));
  return {
    ...path,
    totalCourses: total,
    completedCourses: done.length,
    progressPct: total ? Math.round((done.length / total) * 100) : 0,
    courses,
  };
}

// Course titles bhi join karo (ordered, sirf published wali detail).
async function courseMetaMap(req, ids) {
  if (!ids.length) return {};
  const tf = tenantFilter(req);
  const courses = await prisma.course.findMany({
    where: { ...tf, id: { in: ids } },
    select: { id: true, title: true, slug: true, level: true, durationMin: true, thumbnailUrl: true },
  });
  return Object.fromEntries(courses.map((c) => [c.id, c]));
}

// ------------------------------------------------------------ list ---
// Staff: sab; member: sirf published. ?progress=1 par member ki progress bhi.
router.get('/', requireRole(...READ_ROLES), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const isStaff = STAFF_ROLES.has(req.user.role);
    const where = isStaff ? { ...tf } : { ...tf, isPublished: true };
    const paths = await prisma.learningPath.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
    if (req.query.progress === '1' && !isStaff) {
      const completed = await completedCourseIds(req, req.user.id);
      const allIds = [...new Set(paths.flatMap((p) => (Array.isArray(p.courseIds) ? p.courseIds : [])))];
      const meta = await courseMetaMap(req, allIds);
      return res.json(paths.map((p) => withProgress(p, completed, meta)));
    }
    res.json(paths);
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- detail ---
router.get('/:id', requireRole(...READ_ROLES), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const isStaff = STAFF_ROLES.has(req.user.role);
    const path = await prisma.learningPath.findFirst({
      where: { ...tf, id: req.params.id },
    });
    if (!path || (!isStaff && !path.isPublished)) {
      return res.status(404).json({ error: 'Learning path not found' });
    }
    const ids = Array.isArray(path.courseIds) ? path.courseIds : [];
    const meta = await courseMetaMap(req, ids);
    if (isStaff) {
      return res.json({ ...path, courses: ids.map((id) => ({ id, ...(meta[id] || {}) })) });
    }
    const completed = await completedCourseIds(req, req.user.id);
    res.json(withProgress(path, completed, meta));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------- my progress ---
router.get('/:id/my-progress', requireRole(...READ_ROLES), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const path = await prisma.learningPath.findFirst({
      where: { ...tf, id: req.params.id, isPublished: true },
    });
    if (!path) return res.status(404).json({ error: 'Learning path not found' });
    const completed = await completedCourseIds(req, req.user.id);
    res.json(withProgress(path, completed));
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- create ---
router.post('/', write, validateBody(pathSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    // Course ids verify karo — sab isi tenant ke hon.
    const ids = req.body.courseIds || [];
    if (ids.length) {
      const count = await prisma.course.count({ where: { ...tf, id: { in: ids } } });
      if (count !== ids.length) {
        return res.status(400).json({ error: 'Some courseIds are invalid for this tenant' });
      }
    }
    const path = await prisma.learningPath.create({
      data: { ...tf, ...req.body },
    });
    res.status(201).json(path);
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- update ---
router.patch('/:id', write, validateBody(pathUpdateSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.learningPath.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Learning path not found' });
    if (req.body.courseIds) {
      const count = await prisma.course.count({ where: { ...tf, id: { in: req.body.courseIds } } });
      if (count !== req.body.courseIds.length) {
        return res.status(400).json({ error: 'Some courseIds are invalid for this tenant' });
      }
    }
    const path = await prisma.learningPath.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(path);
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- delete ---
router.delete('/:id', write, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.learningPath.findFirst({ where: { ...tf, id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Learning path not found' });
    await prisma.learningPath.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
