// Phase 33 Track 9: NPS Surveys API.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

// Resolve the member record for the logged-in user (memberId from JWT, fallback to email).
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

function npsStats(responses) {
  const scored = responses.filter((r) => Number.isInteger(r.score));
  const n = scored.length;
  const promoters = scored.filter((r) => r.score >= 9).length;
  const passives = scored.filter((r) => r.score >= 7 && r.score <= 8).length;
  const detractors = scored.filter((r) => r.score <= 6).length;
  const nps = n === 0 ? null : Math.round(((promoters - detractors) / n) * 100);
  const distribution = {};
  for (let s = 0; s <= 10; s++) distribution[s] = 0;
  scored.forEach((r) => { distribution[r.score]++; });
  return { responses: n, promoters, passives, detractors, nps, distribution };
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['nps', 'custom']).optional().default('nps'),
  status: z.enum(['draft', 'active', 'closed']).optional().default('draft'),
});

// POST /api/surveys — staff creates a survey
router.post('/', staffOnly, validateBody(createSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { title, type, status } = req.body;
    const survey = await prisma.survey.create({
      data: { tenantId: tf.tenantId, title, type, status },
    });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'survey.create',
      entity: 'Survey', entityId: survey.id, newValue: { title, status },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.status(201).json({ survey });
  } catch (err) {
    return next(err);
  }
});

// GET /api/surveys — staff list with response counts
router.get('/', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const surveys = await prisma.survey.findMany({
      where: { ...tf },
      include: { _count: { select: { responses: true, invites: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ surveys });
  } catch (err) {
    return next(err);
  }
});

// GET /api/surveys/active — member's pending surveys (not yet responded)
router.get('/active', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    const surveys = await prisma.survey.findMany({
      where: { ...tf, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!member) return res.json({ surveys, pending: [] });
    const responded = await prisma.surveyResponse.findMany({
      where: { memberId: member.id, survey: { tenantId: tf.tenantId } },
      select: { surveyId: true },
    });
    const respondedIds = new Set(responded.map((r) => r.surveyId));
    const pending = surveys.filter((s) => !respondedIds.has(s.id));
    return res.json({ surveys, pending });
  } catch (err) {
    return next(err);
  }
});

const respondSchema = z.object({
  score: z.number().int().min(0).max(10).optional(),
  comment: z.string().max(2000).optional(),
});

// POST /api/surveys/:id/respond — member submits response (one-time)
router.post('/:id/respond', validateBody(respondSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });
    const survey = await prisma.survey.findFirst({ where: { id: req.params.id, ...tf } });
    if (!survey) return res.status(404).json({ error: { message: 'Survey not found.' } });
    if (survey.status !== 'active') {
      return res.status(400).json({ error: { message: 'This survey is not active.' } });
    }
    const { score, comment } = req.body;
    const answers = comment ? { comment } : undefined;
    try {
      const response = await prisma.surveyResponse.create({
        data: { surveyId: survey.id, memberId: member.id, score: score ?? null, answers },
      });
      writeAudit({
        tenantId: tf.tenantId, actorId: req.user.sub, action: 'survey.respond',
        entity: 'SurveyResponse', entityId: response.id, newValue: { surveyId: survey.id, score },
        ip: req.ip, userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(201).json({ response });
    } catch (err) {
      if (String(err.code) === 'P2002') {
        return res.status(409).json({ error: { message: 'You have already responded to this survey.' } });
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

// GET /api/surveys/:id/results — staff: NPS score, distribution, comments
router.get('/:id/results', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const survey = await prisma.survey.findFirst({
      where: { id: req.params.id, ...tf },
      include: {
        responses: {
          include: { member: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!survey) return res.status(404).json({ error: { message: 'Survey not found.' } });
    const stats = npsStats(survey.responses);
    const comments = survey.responses
      .filter((r) => r.answers && r.answers.comment)
      .map((r) => ({
        memberName: r.member?.name || 'Anonymous',
        score: r.score,
        comment: r.answers.comment,
        createdAt: r.createdAt,
      }));
    return res.json({ survey: { id: survey.id, title: survey.title, type: survey.type, status: survey.status }, stats, comments });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/surveys/:id — staff updates title/status (activate/close)
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
});
router.patch('/:id', staffOnly, validateBody(updateSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const survey = await prisma.survey.updateMany({
      where: { id: req.params.id, ...tf },
      data: req.body,
    });
    if (survey.count === 0) return res.status(404).json({ error: { message: 'Survey not found.' } });
    const updated = await prisma.survey.findFirst({ where: { id: req.params.id, ...tf } });
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'survey.update',
      entity: 'Survey', entityId: req.params.id, newValue: req.body,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ survey: updated });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.npsStats = npsStats;
