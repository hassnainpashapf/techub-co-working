// Phase 42 Track 5: Performance Reviews API.
// Mount: /api/reviews (coordinator). Frontend: /hr/reviews.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { createNotification } = require('../lib/notify');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const HR_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const hrOnly = requireRole(...HR_ROLES);

// Schema merge se pehle 503 guard (parallel-track safe).
function reviewsEnabled(req, res, next) {
  if (!prisma.performanceReview) {
    return res.status(503).json({ error: 'Performance reviews schema pending migration' });
  }
  next();
}
router.use(reviewsEnabled);

const STATUSES = ['draft', 'submitted', 'acknowledged'];
const CRITERIA = ['punctuality', 'quality', 'teamwork'];

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'PerformanceReview', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

function notifySafe(payload) {
  try { createNotification(prisma, payload).catch(() => {}); } catch {}
}

function computeOverall(ratings) {
  const vals = CRITERIA.map((c) => Number(ratings[c])).filter((v) => v >= 1 && v <= 5);
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

// Employee ke khud ko (acknowledge ke liye) identify karo.
async function myEmployeeId(req, tf) {
  if (req.user.role && HR_ROLES.includes(req.user.role)) return null; // HR ko guard ki zaroorat nahi
  if (prisma.employee) {
    const emp = await prisma.employee.findFirst({
      where: { tenantId: tf.tenantId, OR: [{ userId: req.user.sub }, { email: req.user.email }] },
      select: { id: true },
    }).catch(() => null);
    if (emp) return emp.id;
  }
  return null;
}

// ---------- LIST ----------
router.get('/', hrOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.employeeId) where.employeeId = String(req.query.employeeId);
    if (req.query.status && STATUSES.includes(req.query.status)) where.status = req.query.status;
    if (req.query.period) where.period = String(req.query.period);
    const reviews = await prisma.performanceReview.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, designation: true, department: true } },
        reviewer: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    }).catch(() => prisma.performanceReview.findMany({ where, orderBy: [{ period: 'desc' }, { createdAt: 'desc' }], take: 200 }));
    res.json({ reviews, periods: currentPeriod() });
  } catch (e) { next(e); }
});

// ---------- CREATE (draft) ----------
const ratingsSchema = z.object({
  punctuality: z.number().int().min(1).max(5).optional(),
  quality: z.number().int().min(1).max(5).optional(),
  teamwork: z.number().int().min(1).max(5).optional(),
});
const reviewSchema = z.object({
  employeeId: z.string().min(1),
  period: z.string().regex(/^\d{4}-Q[1-4]$/, 'period YYYY-QN ho, e.g. 2026-Q3').default(currentPeriod()),
  ratings: ratingsSchema.default({}),
  strengths: z.string().max(2000).optional(),
  improvements: z.string().max(2000).optional(),
  goals: z.string().max(2000).optional(),
});

router.post('/', hrOnly, validateBody(reviewSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const body = req.body;
    const emp = await prisma.employee.findFirst({ where: { id: body.employeeId, ...tf } });
    if (!emp) return res.status(404).json({ error: 'Employee nahi mila' });
    const review = await prisma.performanceReview.create({
      data: {
        tenantId: tf.tenantId,
        employeeId: body.employeeId,
        period: body.period,
        reviewerId: req.user.sub,
        ratings: body.ratings || {},
        overall: computeOverall(body.ratings || {}),
        strengths: body.strengths,
        improvements: body.improvements,
        goals: body.goals,
        status: 'draft',
      },
    });
    audit(req, tf, 'review.create', review.id, { employeeId: body.employeeId, period: body.period });
    res.status(201).json({ review });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Is employee ka is period ka review pehle se hai' });
    next(e);
  }
});

// ---------- HISTORY (employee-wise timeline) ----------
router.get('/history/:employeeId', hrOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const rows = await prisma.performanceReview.findMany({
      where: { ...tf, employeeId: req.params.employeeId },
      orderBy: [{ period: 'desc' }],
      include: { reviewer: { select: { name: true } } },
    }).catch(() => []);
    res.json({ history: rows });
  } catch (e) { next(e); }
});

// ---------- DETAIL ----------
router.get('/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const review = await prisma.performanceReview.findFirst({ where: { id: req.params.id, ...tf } });
    if (!review) return res.status(404).json({ error: 'Review nahi mila' });
    const mine = await myEmployeeId(req, tf);
    const isHr = HR_ROLES.includes(req.user.role);
    const isOwn = mine && review.employeeId === mine;
    if (!isHr && !isOwn) return res.status(403).json({ error: 'Access nahi hai' });
    res.json({ review });
  } catch (e) { next(e); }
});

// ---------- UPDATE (draft-only) ----------
router.patch('/:id', hrOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const review = await prisma.performanceReview.findFirst({ where: { id: req.params.id, ...tf } });
    if (!review) return res.status(404).json({ error: 'Review nahi mila' });
    if (review.status !== 'draft') return res.status(409).json({ error: 'Sirf draft review edit ho sakta hai' });
    const allowed = {};
    for (const k of ['ratings', 'strengths', 'improvements', 'goals']) {
      if (req.body[k] !== undefined) allowed[k] = req.body[k];
    }
    if (allowed.ratings) {
      const parsed = ratingsSchema.safeParse(allowed.ratings);
      if (!parsed.success) return res.status(400).json({ error: 'Ratings 1-5 ke darmiyan hon' });
      allowed.ratings = parsed.data;
      allowed.overall = computeOverall(parsed.data);
    }
    const updated = await prisma.performanceReview.update({ where: { id: review.id }, data: allowed });
    audit(req, tf, 'review.update', review.id, allowed);
    res.json({ review: updated });
  } catch (e) { next(e); }
});

// ---------- DELETE (draft-only) ----------
router.delete('/:id', hrOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const review = await prisma.performanceReview.findFirst({ where: { id: req.params.id, ...tf } });
    if (!review) return res.status(404).json({ error: 'Review nahi mila' });
    if (review.status !== 'draft') return res.status(409).json({ error: 'Sirf draft review delete ho sakta hai' });
    await prisma.performanceReview.delete({ where: { id: review.id } });
    audit(req, tf, 'review.delete', review.id, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- SUBMIT ----------
router.post('/:id/submit', hrOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const review = await prisma.performanceReview.findFirst({
      where: { id: req.params.id, ...tf },
      include: { employee: { select: { id: true, name: true, userId: true, email: true } } },
    }).catch(() => null);
    if (!review) return res.status(404).json({ error: 'Review nahi mila' });
    if (review.status !== 'draft') return res.status(409).json({ error: 'Review pehle se submit hai' });
    const updated = await prisma.performanceReview.update({
      where: { id: review.id }, data: { status: 'submitted', submittedAt: new Date() },
    });
    audit(req, tf, 'review.submit', review.id, { period: review.period });
    // Employee ko notification (linked user ho to direct, warna HR-visible role-based).
    const emp = review.employee;
    notifySafe({
      tenantId: tf.tenantId,
      userId: emp && emp.userId ? emp.userId : null,
      role: emp && emp.userId ? null : 'manager',
      type: 'review.submitted',
      message: `Aap ka performance review (${review.period}) submit ho gaya hai — dekh kar acknowledge karein.`,
    });
    res.json({ review: updated });
  } catch (e) { next(e); }
});

// ---------- ACKNOWLEDGE (employee khud) ----------
router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const review = await prisma.performanceReview.findFirst({ where: { id: req.params.id, ...tf } });
    if (!review) return res.status(404).json({ error: 'Review nahi mila' });
    if (review.status !== 'submitted') return res.status(409).json({ error: 'Sirf submitted review acknowledge ho sakta hai' });
    const isHr = HR_ROLES.includes(req.user.role);
    if (!isHr) {
      const mine = await myEmployeeId(req, tf);
      if (!mine || review.employeeId !== mine) {
        return res.status(403).json({ error: 'Sirf reviewed employee ya HR acknowledge kar sakta hai' });
      }
    }
    const updated = await prisma.performanceReview.update({
      where: { id: review.id }, data: { status: 'acknowledged' },
    });
    audit(req, tf, 'review.acknowledge', review.id, null);
    res.json({ review: updated });
  } catch (e) { next(e); }
});

module.exports = router;
