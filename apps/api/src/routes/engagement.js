// Phase 40 Track 10: Member Engagement Score Dashboard.
// Phase 35 ka churn "risk" measure karta hai (overdue invoices, contract expiry).
// Ye "engagement" measure karta hai: bookings, events, feedback/polls,
// referrals, app login recency — at-risk yahan matlab disengaged member.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { notify } = require('../lib/mailer');
const { fetchEngagementData } = require('../lib/engagementScore');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

const VALID_TIERS = ['champion', 'active', 'casual', 'at-risk'];

function summarize(members) {
  const distribution = { champion: 0, active: 0, casual: 0, 'at-risk': 0 };
  for (const m of members) distribution[m.tier] = (distribution[m.tier] || 0) + 1;
  return {
    total: members.length,
    distribution,
    avgScore: members.length ? Math.round(members.reduce((s, m) => s + m.score, 0) / members.length) : 0,
    atRiskCount: distribution['at-risk'] || 0,
    championCount: distribution.champion || 0,
  };
}

// GET /api/engagement — sab members, tier filter + score sort, breakdown ke sath.
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tier = (req.query.tier || '').toLowerCase();
    const sort = req.query.sort === 'score_asc' ? 'score_asc' : 'score_desc';
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));

    let members = await fetchEngagementData(tf.tenantId);
    if (tier && VALID_TIERS.includes(tier)) {
      members = members.filter((m) => m.tier === tier);
    }
    members.sort((a, b) => (sort === 'score_asc' ? a.score - b.score : b.score - a.score));

    return res.json({
      summary: summarize(await fetchEngagementData(tf.tenantId)),
      members: members.slice(0, limit),
      count: members.length,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/engagement/at-risk — engagement-based churn risk list (phase 35 se alag).
router.get('/at-risk', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const members = await fetchEngagementData(tf.tenantId);
    const atRisk = members
      .filter((m) => m.tier === 'at-risk')
      .sort((a, b) => a.score - b.score)
      .map((m) => ({
        ...m,
        suggestedAction: m.score < 20 ? 'Call directly — bohat disengaged' : 'Retention offer bhejo',
      }));
    return res.json({ count: atRisk.length, members: atRisk });
  } catch (err) {
    return next(err);
  }
});

// GET /api/engagement/:memberId/score — single member breakdown.
router.get('/:memberId/score', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const exists = await prisma.member.findFirst({ where: { ...tf, id: req.params.memberId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: 'Member not found' });
    const members = await fetchEngagementData(tf.tenantId);
    const m = members.find((x) => x.id === req.params.memberId);
    if (!m) return res.status(404).json({ error: 'Member not found' });
    return res.json(m);
  } catch (err) {
    return next(err);
  }
});

// POST /api/engagement/retention-offer — at-risk member ko retention email (phase 35 churn wala pattern).
router.post('/retention-offer', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { memberId, message } = req.body || {};
    if (!memberId) return res.status(400).json({ error: 'memberId is required' });

    const member = await prisma.member.findFirst({
      where: { ...tf, id: memberId },
      select: { id: true, name: true, email: true },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (!member.email) return res.status(400).json({ error: 'Member has no email address' });

    const result = await notify(req.user.tenantId, member.email, 'retentionOffer', {
      memberName: member.name,
      customMessage: message || '',
    });

    writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.id,
      action: 'engagement.retention_offer_sent',
      entity: 'member',
      entityId: member.id,
    }).catch(() => {});

    return res.json({ sent: !!(result && (result.sent || result.queued)), result });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
