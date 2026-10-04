// Phase 54 Track 6/10: 30-Day Feedback Auto-NPS routes.
// Mount (coordinator): app.use('/api/onboarding-feedback', require('./routes/onboarding-feedback'));
// server.js / Sidebar.js nahi chhue. Sidebar link nahi — Success section extend.
// Public:  GET  /:token  — token verify → survey meta (koi login nahi)
//           POST /:token  — token verify → feedback save (unique per member)
// Staff:   GET  /        — list + NPS aggregate (auth + staff roles)
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { verifyNpsToken } = require('../lib/onboardingNps');

const router = express.Router();

const STAFF = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];

function npsEnabled() {
  return !!(prisma && prisma.onboardingFeedback && prisma.member);
}
function guard503(req, res, next) {
  if (!npsEnabled()) return res.status(503).json({ error: 'Onboarding NPS schema pending migration' });
  next();
}
router.use(guard503);

function audit(req, tf, action, entityId, newValue) {
  writeAudit({
    tenantId: tf.tenantId, actorId: req.user.sub, action,
    entity: 'OnboardingFeedback', entityId, newValue,
    ip: req.ip, userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

// Token → tenant-scoped member resolve (public, login nahi).
async function resolveTokenMember(token) {
  const check = verifyNpsToken(token);
  if (!check.ok) return { error: check.reason };
  const { tenantId, memberId } = check.payload;
  const member = await prisma.member.findFirst({
    where: { id: memberId, tenantId },
    select: { id: true, tenantId: true, name: true, status: true },
  });
  if (!member) return { error: 'member-not-found' };
  const feedback = await prisma.onboardingFeedback.findUnique({
    where: { tenantId_memberId: { tenantId, memberId } },
  }).catch(() => null);
  return { member, feedback, tenantId };
}

// GET /api/onboarding-feedback/:token — public: survey page ke liye meta.
router.get('/:token', async (req, res) => {
  try {
    const r = await resolveTokenMember(req.params.token);
    if (r.error) return res.status(400).json({ error: 'Ghalat ya expired link', reason: r.error });
    const tenant = await prisma.tenant.findUnique({
      where: { id: r.tenantId }, select: { name: true },
    }).catch(() => null);
    res.json({
      ok: true,
      tenantName: tenant?.name || 'Techub',
      firstName: String(r.member.name || '').split(' ')[0] || 'Member',
      alreadySubmitted: !!r.feedback,
      submittedAt: r.feedback?.submittedAt || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/onboarding-feedback/:token — public: score submit (ek member ek dafa).
router.post(
  '/:token',
  validateBody(z.object({
    score: z.number().int().min(0).max(10),
    comment: z.string().max(2000).optional(),
  })),
  async (req, res) => {
    try {
      const r = await resolveTokenMember(req.params.token);
      if (r.error) return res.status(400).json({ error: 'Ghalat ya expired link', reason: r.error });
      if (r.feedback) return res.status(409).json({ error: 'Aap feedback pehle de chuke hain' });

      const { score, comment } = req.body;
      const created = await prisma.onboardingFeedback.create({
        data: {
          tenantId: r.tenantId,
          memberId: r.member.id,
          score,
          comment: comment?.trim() || null,
        },
      });
      res.status(201).json({ ok: true, id: created.id, score });
    } catch (e) {
      // race: unique constraint (P2002) — dobara submit ka safe jawab
      if (e && e.code === 'P2002') return res.status(409).json({ error: 'Aap feedback pehle de chuke hain' });
      res.status(500).json({ error: e.message });
    }
  }
);

// ---- Staff (auth ke baad) ----
router.use(authenticate, requireTenantUser, requireRole(...STAFF));

// GET /api/onboarding-feedback — staff: list + NPS aggregate.
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const { minScore, maxScore, from, to, limit = '50' } = req.query;
    const where = { ...tf };
    if (minScore !== undefined) where.score = { ...(where.score || {}), gte: Number(minScore) };
    if (maxScore !== undefined) where.score = { ...(where.score || {}), lte: Number(maxScore) };
    if (from || to) {
      where.submittedAt = {};
      if (from) where.submittedAt.gte = new Date(from);
      if (to) where.submittedAt.lte = new Date(to);
    }

    const items = await prisma.onboardingFeedback.findMany({
      where,
      include: { member: { select: { id: true, name: true, email: true } } },
      orderBy: { submittedAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
    });

    const all = await prisma.onboardingFeedback.findMany({
      where: tf, select: { score: true },
    });
    const promoters = all.filter(f => f.score >= 9).length;
    const passives = all.filter(f => f.score >= 7 && f.score <= 8).length;
    const detractors = all.filter(f => f.score <= 6).length;
    const total = all.length;
    const avg = total ? Math.round((all.reduce((s, f) => s + f.score, 0) / total) * 10) / 10 : 0;
    const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;

    res.json({
      items,
      aggregate: { total, promoters, passives, detractors, avg, nps },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
