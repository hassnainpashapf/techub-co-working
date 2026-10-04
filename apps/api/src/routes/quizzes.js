// Phase 53 Track 3: Quizzes.
// Mount (coordinator): app.use('/api/quizzes', require('./routes/quizzes'));
// Staff: quiz + questions ka CRUD aur attempts ki list.
// Member: GET quiz (correctIndex KE BAGHAIR), POST attempt → server auto-grade.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist'];
// NOTE: Track 6 (Instructor Dashboard) jab 'instructor' role laye to STAFF
// list me add kar dein — coordinator merge ke waqt dekh le.

const questionSchema = z.object({
  question: z.string().min(1).max(2000),
  type: z.enum(['mcq', 'truefalse']).default('mcq'),
  options: z.array(z.string().min(1)).min(2).max(10),
  correctIndex: z.number().int().min(0),
  points: z.number().int().min(1).max(100).default(1),
  sortOrder: z.number().int().min(0).default(0),
});

const quizSchema = z.object({
  lessonId: z.string().min(1),
  title: z.string().max(200).optional().nullable(),
  passingPct: z.number().int().min(0).max(100).default(70),
  maxAttempts: z.number().int().min(1).max(100).optional().nullable(),
  isActive: z.boolean().default(true),
});

// Sirf staff ko jawab (correctIndex) wapas bhejta hai.
function withAnswers(quiz) {
  return quiz;
}
// Member ko jawab chhupata hai.
function withoutAnswers(quiz) {
  if (!quiz) return quiz;
  return {
    ...quiz,
    questions: (quiz.questions || []).map((q) => {
      const { correctIndex, ...rest } = q; // eslint-disable-line no-unused-vars
      return rest;
    }),
  };
}

// ---------- Staff: quizzes CRUD ----------

// POST /api/quizzes — naya quiz banao (staff)
router.post('/', requireRole(...STAFF), async (req, res, next) => {
  try {
    const body = quizSchema.parse(req.body || {});
    const tf = tenantFilter(req);

    const lesson = await prisma.lesson.findFirst({
      where: { id: body.lessonId, ...tf },
      select: { id: true, title: true },
    });
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const existing = await prisma.quiz.findUnique({ where: { lessonId: body.lessonId } });
    if (existing) return res.status(409).json({ error: 'Is lesson ka quiz pehle se mojud hai' });

    const quiz = await prisma.quiz.create({
      data: {
        tenantId: tf.tenantId,
        lessonId: body.lessonId,
        title: body.title || null,
        passingPct: body.passingPct,
        maxAttempts: body.maxAttempts ?? null,
        isActive: body.isActive,
      },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'quiz.create',
      entity: 'Quiz', entityId: quiz.id, newValue: { lessonId: quiz.lessonId },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.status(201).json(quiz);
  } catch (e) { next(e); }
});

// GET /api/quizzes — sab quizzes (staff, jawab samet)
router.get('/', requireRole(...STAFF), async (req, res, next) => {
  try {
    const quizzes = await prisma.quiz.findMany({
      where: { ...tenantFilter(req) },
      include: {
        lesson: { select: { id: true, title: true } },
        questions: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(quizzes);
  } catch (e) { next(e); }
});

// GET /api/quizzes/:id — ek quiz detail (staff, jawab samet)
router.get('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const quiz = await prisma.quiz.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: {
        lesson: { select: { id: true, title: true } },
        questions: { orderBy: { sortOrder: 'asc' } },
        attempts: {
          include: { member: { select: { id: true, name: true, email: true } } },
          orderBy: { attemptedAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    res.json(withAnswers(quiz));
  } catch (e) { next(e); }
});

// PUT /api/quizzes/:id — quiz update (staff)
router.put('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const body = quizSchema.partial().omit({ lessonId: true }).parse(req.body || {});
    const tf = tenantFilter(req);
    const quiz = await prisma.quiz.findFirst({ where: { id: req.params.id, ...tf } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const updated = await prisma.quiz.update({
      where: { id: quiz.id },
      data: {
        title: body.title !== undefined ? body.title : undefined,
        passingPct: body.passingPct,
        maxAttempts: body.maxAttempts !== undefined ? (body.maxAttempts ?? null) : undefined,
        isActive: body.isActive,
      },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'quiz.update',
      entity: 'Quiz', entityId: quiz.id, newValue: body,
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json(updated);
  } catch (e) { next(e); }
});

// DELETE /api/quizzes/:id — quiz delete (staff; questions + attempts cascade)
router.delete('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const quiz = await prisma.quiz.findFirst({ where: { id: req.params.id, ...tf } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    await prisma.quiz.delete({ where: { id: quiz.id } });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'quiz.delete',
      entity: 'Quiz', entityId: quiz.id,
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Staff: questions CRUD ----------

// POST /api/quizzes/:id/questions — sawal add karo (staff)
router.post('/:id/questions', requireRole(...STAFF), async (req, res, next) => {
  try {
    const body = questionSchema.parse(req.body || {});
    const tf = tenantFilter(req);
    const quiz = await prisma.quiz.findFirst({ where: { id: req.params.id, ...tf } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (body.correctIndex >= body.options.length) {
      return res.status(400).json({ error: 'correctIndex options ki range se bahar hai' });
    }
    if (body.type === 'truefalse' && body.options.length !== 2) {
      return res.status(400).json({ error: 'truefalse ke liye exactly 2 options hon' });
    }

    const question = await prisma.quizQuestion.create({
      data: {
        tenantId: tf.tenantId,
        quizId: quiz.id,
        question: body.question,
        type: body.type,
        options: body.options,
        correctIndex: body.correctIndex,
        points: body.points,
        sortOrder: body.sortOrder,
      },
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'quiz_question.create',
      entity: 'QuizQuestion', entityId: question.id, newValue: { quizId: quiz.id },
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.status(201).json(question);
  } catch (e) { next(e); }
});

// PUT /api/quizzes/questions/:questionId — sawal update (staff)
router.put('/questions/:questionId', requireRole(...STAFF), async (req, res, next) => {
  try {
    const body = questionSchema.partial().parse(req.body || {});
    const tf = tenantFilter(req);
    const question = await prisma.quizQuestion.findFirst({
      where: { id: req.params.questionId, ...tf },
      include: { quiz: true },
    });
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const options = body.options ?? question.options;
    const correctIndex = body.correctIndex ?? question.correctIndex;
    if (correctIndex >= options.length) {
      return res.status(400).json({ error: 'correctIndex options ki range se bahar hai' });
    }

    const updated = await prisma.quizQuestion.update({
      where: { id: question.id },
      data: {
        question: body.question,
        type: body.type,
        options: body.options,
        correctIndex: body.correctIndex,
        points: body.points,
        sortOrder: body.sortOrder,
      },
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'quiz_question.update',
      entity: 'QuizQuestion', entityId: question.id, newValue: body,
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json(updated);
  } catch (e) { next(e); }
});

// DELETE /api/quizzes/questions/:questionId — sawal delete (staff)
router.delete('/questions/:questionId', requireRole(...STAFF), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const question = await prisma.quizQuestion.findFirst({
      where: { id: req.params.questionId, ...tf },
    });
    if (!question) return res.status(404).json({ error: 'Question not found' });
    await prisma.quizQuestion.delete({ where: { id: question.id } });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'quiz_question.delete',
      entity: 'QuizQuestion', entityId: question.id,
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/quizzes/:id/attempts — attempts list (staff)
router.get('/:id/attempts', requireRole(...STAFF), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const quiz = await prisma.quiz.findFirst({ where: { id: req.params.id, ...tf } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId: quiz.id, ...tf },
      include: { member: { select: { id: true, name: true, email: true } } },
      orderBy: { attemptedAt: 'desc' },
      take: 100,
    });
    res.json(attempts);
  } catch (e) { next(e); }
});

// ---------- Member ----------

// GET /api/quizzes/my/quiz/:lessonId — lesson ka quiz (JAWAB CHHUPAYE HUAY)
router.get('/my/quiz/:lessonId', requireRole('member'), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const quiz = await prisma.quiz.findFirst({
      where: { lessonId: req.params.lessonId, ...tf },
      include: {
        lesson: { select: { id: true, title: true } },
        questions: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!quiz || !quiz.isActive) return res.status(404).json({ error: 'Is lesson ke liye quiz nahi hai' });

    let attempts = [];
    let remaining = quiz.maxAttempts ?? null;
    if (req.user.memberId) {
      attempts = await prisma.quizAttempt.findMany({
        where: { quizId: quiz.id, memberId: req.user.memberId, ...tf },
        orderBy: { attemptedAt: 'desc' },
      });
      if (quiz.maxAttempts != null) remaining = Math.max(0, quiz.maxAttempts - attempts.length);
    }
    const best = attempts.length ? Math.max(...attempts.map((a) => a.score)) : null;

    res.json({
      ...withoutAnswers(quiz),
      myAttempts: attempts.map((a) => ({
        id: a.id, score: a.score, passed: a.passed, attemptedAt: a.attemptedAt,
      })),
      bestScore: best,
      remainingAttempts: remaining,
    });
  } catch (e) { next(e); }
});

const attemptSchema = z.object({
  quizId: z.string().min(1),
  answers: z.array(z.object({
    questionId: z.string().min(1),
    selectedIndex: z.number().int().min(0),
  })).min(1).max(100),
});

// POST /api/quizzes/attempts — jawab submit → auto-grade (member)
router.post('/attempts', requireRole('member'), async (req, res, next) => {
  try {
    const body = attemptSchema.parse(req.body || {});
    const tf = tenantFilter(req);
    if (!req.user.memberId) {
      return res.status(403).json({ error: 'Attempt ke liye member account zaroori hai' });
    }
    const member = await prisma.member.findFirst({
      where: { id: req.user.memberId, ...tf },
      select: { id: true },
    });
    if (!member) return res.status(403).json({ error: 'Member not found' });

    const quiz = await prisma.quiz.findFirst({
      where: { id: body.quizId, ...tf },
      include: { questions: true },
    });
    if (!quiz || !quiz.isActive) return res.status(404).json({ error: 'Quiz not found ya inactive hai' });

    // Attempt limit enforce karo
    if (quiz.maxAttempts != null) {
      const used = await prisma.quizAttempt.count({
        where: { quizId: quiz.id, memberId: member.id, ...tf },
      });
      if (used >= quiz.maxAttempts) {
        return res.status(429).json({ error: `Attempt limit khatam ho gayi (${quiz.maxAttempts}/${quiz.maxAttempts})` });
      }
    }

    // Auto-grade: har sawal ke points ka wazan
    const byId = new Map(quiz.questions.map((q) => [q.id, q]));
    let totalPoints = 0;
    let earnedPoints = 0;
    const graded = [];
    for (const a of body.answers) {
      const q = byId.get(a.questionId);
      if (!q) continue; // ghair-mutaliq sawal nazar-andaz
      totalPoints += q.points;
      const correct = a.selectedIndex === q.correctIndex;
      if (correct) earnedPoints += q.points;
      graded.push({ questionId: q.id, selectedIndex: a.selectedIndex, correct });
    }
    const score = totalPoints > 0
      ? Math.round((earnedPoints / totalPoints) * 10000) / 100
      : 0;
    const passed = score >= quiz.passingPct;

    const attempt = await prisma.quizAttempt.create({
      data: {
        tenantId: tf.tenantId,
        quizId: quiz.id,
        memberId: member.id,
        score,
        passed,
        answers: graded,
      },
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'quiz.attempt',
      entity: 'QuizAttempt', entityId: attempt.id,
      newValue: { quizId: quiz.id, score, passed },
      ip: req.ip, userAgent: req.get('user-agent'),
    });

    // NOTE: jawab me correctIndex NAHI bheja jata — sirf per-question
    // sahi/ghalat taake retry par answers leak na hon.
    res.status(201).json({
      attemptId: attempt.id,
      score,
      passed,
      passingPct: quiz.passingPct,
      totalPoints,
      earnedPoints,
      details: graded,
      attemptedAt: attempt.attemptedAt,
    });
  } catch (e) { next(e); }
});

module.exports = router;
