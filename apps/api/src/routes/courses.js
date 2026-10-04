// Phase 53 Track 1/10: Course Catalog — Course + Lesson CRUD.
// Coordinator ke liye:
//   Mount: app.use('/api/courses', require('./routes/courses'));
//   Sidebar: { label: 'Academy', path: '/academy/courses' } — roles: ceo/admin/super_admin/manager (+ member portal Track 4 me)
// Public endpoints (bina auth): GET /api/courses/public — published courses,
// GET /api/courses/public/:slug — published course + lessons (free preview logic included).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

function coursesOr503(res) {
  if (!prisma.course) {
    res.status(503).json({ error: 'Academy module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.course;
}

function lessonsOr503(res) {
  if (!prisma.lesson) {
    res.status(503).json({ error: 'Academy module abhi migrate nahi hua.' });
    return null;
  }
  return prisma.lesson;
}

const LEVELS = ['beginner', 'intermediate', 'advanced'];
const LESSON_TYPES = ['video', 'text', 'file', 'quiz'];

const lessonSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(LESSON_TYPES).optional().default('text'),
  contentUrl: z.string().max(2000).optional().nullable(),
  body: z.string().max(20000).optional().nullable(),
  durationMin: z.number().int().min(0).max(600).optional().nullable(),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
  isFree: z.boolean().optional().default(false),
});

const courseSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, 'Slug sirf lowercase, numbers aur dashes').optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  category: z.string().max(60).optional().default('general'),
  level: z.enum(LEVELS).optional().default('beginner'),
  thumbnailUrl: z.string().max(2000).optional().nullable(),
  instructorId: z.string().max(64).optional().nullable(),
  price: z.number().min(0).optional().nullable(),
  durationMin: z.number().int().min(0).optional().nullable(),
});

const slugify = (s) =>
  String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

const lessonPublic = (l) => ({
  ...l,
  // paid course me sirf free lessons ka body/content preview me bhejo
  body: l.isFree ? l.body : undefined,
  contentUrl: l.isFree ? l.contentUrl : undefined,
});

// ---------- Public (bina auth) ----------
// Public catalog — tenantSlug query param se tenant resolve hota hai (event-tickets pattern).
async function publicTenant(req, res) {
  const slug = String(req.query.tenantSlug || '').trim();
  if (!slug) { res.status(400).json({ error: 'tenantSlug required' }); return null; }
  const t = await prisma.tenant.findFirst({ where: { slug, isActive: true }, select: { id: true } });
  if (!t) { res.status(404).json({ error: 'Space not found' }); return null; }
  return t.id;
}

router.get('/public', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const tenantId = await publicTenant(req, res); if (!tenantId) return;
    const where = { tenantId, isPublished: true };
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.level) where.level = String(req.query.level);
    if (req.query.search) where.title = { contains: String(req.query.search), mode: 'insensitive' };
    const courses = await C.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { lessons: true } } },
    });
    res.json({ courses: courses.map((c) => ({ ...c, lessonCount: c._count.lessons, _count: undefined })) });
  } catch (e) { next(e); }
});

router.get('/public/:slug', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const L = lessonsOr503(res); if (!L) return;
    const tenantId = await publicTenant(req, res); if (!tenantId) return;
    const course = await C.findFirst({ where: { slug: req.params.slug, tenantId, isPublished: true } });
    if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
    const lessons = await L.findMany({
      where: { courseId: course.id },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ course, lessons: lessons.map(lessonPublic) });
  } catch (e) { next(e); }
});

// ---------- Member (auth, Track 5) ----------
// GET /api/courses/member/:slug — enrolled member ko course + lessons (full content
// sirf enrolled ke liye; bina enrollment ke free-preview logic jaisa public route).
// Portal detail page isi ko use karti hai.
router.get('/member/:slug', authenticate, requireTenantUser, async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const L = lessonsOr503(res); if (!L) return;
    const tf = tenantFilter(req);
    const course = await C.findFirst({ where: { slug: req.params.slug, ...tf, isPublished: true } });
    if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
    const lessons = await L.findMany({
      where: { courseId: course.id },
      orderBy: { sortOrder: 'asc' },
    });
    let enrolled = false;
    if (req.user.memberId && prisma.enrollment) {
      const en = await prisma.enrollment.findUnique({
        where: {
          tenantId_courseId_memberId: { tenantId: req.user.tenantId, courseId: course.id, memberId: req.user.memberId },
        },
        select: { id: true, status: true },
      });
      enrolled = !!(en && en.status !== 'dropped');
    }
    res.json({
      course,
      lessons: enrolled ? lessons : lessons.map(lessonPublic),
      enrolled,
    });
  } catch (e) { next(e); }
});

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

// ---------- Staff (auth) ----------

// GET /api/courses — staff list (sab: draft + published)
router.get('/', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.level) where.level = String(req.query.level);
    if (req.query.published !== undefined) where.isPublished = req.query.published === 'true';
    if (req.query.search) where.title = { contains: String(req.query.search), mode: 'insensitive' };
    const courses = await C.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { lessons: true } } },
    });
    res.json({ courses: courses.map((c) => ({ ...c, lessonCount: c._count.lessons, _count: undefined })) });
  } catch (e) { next(e); }
});

// POST /api/courses
router.post('/', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const tf = tenantFilter(req);
    const data = courseSchema.parse(req.body);
    const slug = slugify(data.slug || data.title);
    const exists = await C.findFirst({ where: { tenantId: tf.tenantId, slug } });
    if (exists) return res.status(409).json({ error: 'Is slug ka course pehle se hai.' });
    const course = await C.create({ data: { ...data, slug, ...tf } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'course.create', entity: 'Course', entityId: course.id, newValue: { title: course.title } }); } catch {}
    res.status(201).json({ course });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

// GET /api/courses/:id — course + lessons (builder ke liye)
router.get('/:id', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const tf = tenantFilter(req);
    const course = await C.findFirst({
      where: { id: req.params.id, ...tf },
      include: { lessons: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
    res.json({ course });
  } catch (e) { next(e); }
});

// PUT /api/courses/:id
router.put('/:id', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const tf = tenantFilter(req);
    const data = courseSchema.parse(req.body);
    const slug = data.slug !== undefined && data.slug !== null ? slugify(data.slug) : undefined;
    if (slug) {
      const clash = await C.findFirst({ where: { tenantId: tf.tenantId, slug, NOT: { id: req.params.id } } });
      if (clash) return res.status(409).json({ error: 'Is slug ka doosra course pehle se hai.' });
    }
    const upd = await C.updateMany({
      where: { id: req.params.id, ...tf },
      data: { ...data, ...(slug ? { slug } : {}) },
    });
    if (!upd.count) return res.status(404).json({ error: 'Course nahi mila.' });
    const updated = await C.findFirst({ where: { id: req.params.id, ...tf } });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'course.update', entity: 'Course', entityId: req.params.id, newValue: { title: data.title } }); } catch {}
    res.json({ course: updated });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

// PATCH /api/courses/:id/publish
router.patch('/:id/publish', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const tf = tenantFilter(req);
    const isPublished = req.body.isPublished === true;
    if (isPublished) {
      const course = await C.findFirst({
        where: { id: req.params.id, ...tf },
        include: { _count: { select: { lessons: true } } },
      });
      if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
      if (!course._count.lessons) {
        return res.status(422).json({ error: 'Khali course publish nahi ho sakta — pehle lessons joro.' });
      }
    }
    const upd = await C.updateMany({ where: { id: req.params.id, ...tf }, data: { isPublished } });
    if (!upd.count) return res.status(404).json({ error: 'Course nahi mila.' });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: isPublished ? 'course.publish' : 'course.unpublish', entity: 'Course', entityId: req.params.id }); } catch {}
    res.json({ ok: true, isPublished });
  } catch (e) { next(e); }
});

// DELETE /api/courses/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const tf = tenantFilter(req);
    const del = await C.deleteMany({ where: { id: req.params.id, ...tf } });
    if (!del.count) return res.status(404).json({ error: 'Course nahi mila.' });
    try { await writeAudit({ tenantId: tf.tenantId, actorId: req.user.id, action: 'course.delete', entity: 'Course', entityId: req.params.id }); } catch {}
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Lessons (course ke andar) ----------
// POST /api/courses/:id/lessons
router.post('/:id/lessons', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const L = lessonsOr503(res); if (!L) return;
    const tf = tenantFilter(req);
    const course = await C.findFirst({ where: { id: req.params.id, ...tf } });
    if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
    const data = lessonSchema.parse(req.body);
    if (data.sortOrder === 0) {
      const max = await L.findFirst({ where: { courseId: course.id }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
      data.sortOrder = (max?.sortOrder ?? -1) + 1;
    }
    const lesson = await L.create({ data: { ...data, courseId: course.id } });
    res.status(201).json({ lesson });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

// PUT /api/courses/lessons/:lessonId
router.put('/lessons/:lessonId', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const L = lessonsOr503(res); if (!L) return;
    const tf = tenantFilter(req);
    const lesson = await L.findFirst({
      where: { id: req.params.lessonId },
      include: { course: { select: { id: true, tenantId: true } } },
    });
    if (!lesson || lesson.course.tenantId !== tf.tenantId) return res.status(404).json({ error: 'Lesson nahi mila.' });
    const data = lessonSchema.parse(req.body);
    const updated = await L.update({ where: { id: lesson.id }, data });
    res.json({ lesson: updated });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

// DELETE /api/courses/lessons/:lessonId
router.delete('/lessons/:lessonId', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const L = lessonsOr503(res); if (!L) return;
    const tf = tenantFilter(req);
    const lesson = await L.findFirst({
      where: { id: req.params.lessonId },
      include: { course: { select: { tenantId: true } } },
    });
    if (!lesson || lesson.course.tenantId !== tf.tenantId) return res.status(404).json({ error: 'Lesson nahi mila.' });
    await L.delete({ where: { id: lesson.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /api/courses/:id/reorder — [{id, sortOrder}]
router.put('/:id/reorder', async (req, res, next) => {
  try {
    const C = coursesOr503(res); if (!C) return;
    const L = lessonsOr503(res); if (!L) return;
    const tf = tenantFilter(req);
    const course = await C.findFirst({ where: { id: req.params.id, ...tf } });
    if (!course) return res.status(404).json({ error: 'Course nahi mila.' });
    const items = z.array(z.object({ id: z.string(), sortOrder: z.number().int().min(0) })).max(500).parse(req.body.items);
    const ownIds = new Set((await L.findMany({ where: { courseId: course.id }, select: { id: true } })).map((l) => l.id));
    const updates = items.filter((i) => ownIds.has(i.id));
    await prisma.$transaction(updates.map((i) => L.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder } })));
    res.json({ ok: true, updated: updates.length });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Validation fail', details: e.errors });
    next(e);
  }
});

module.exports = router;
