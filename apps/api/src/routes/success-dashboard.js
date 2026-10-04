// Phase 54 Track 10/10: Success Dashboard — member success ka overview.
// Sare sections defensive hain: parallel tracks (1-9) ke models merge na hue hon
// to wo section 0/empty deta hai, poora dashboard 503 nahi hota.
// Koi migration nahi — sirf tracks 1-8 ke models se compute hota hai.
// server.js/Sidebar.js untouched. Mount (coordinator ke liye):
//   app.use('/api/success-dashboard', require('./routes/success-dashboard'));
// Sidebar (coordinator ke liye): { label: 'Member Success', path: '/success' } — roles: ceo, admin, super_admin, manager
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

// Track ke model naam (fragment se) — merge se pehle prisma.<name> undefined hota hai.
// Sibling tracks ke naam thode alag bhi hue to candidates cover kar lete hain.
function m(...names) {
  for (const n of names) {
    if (prisma[n]) return prisma[n];
  }
  return null;
}

const toNum = (d) => (d === null || d === undefined ? 0 : Number(d));

// GET /api/success-dashboard/stats — key numbers.
router.get('/stats', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const stats = {
      activeJourneys: 0,
      avgHealthScore: 0,
      healthSample: 0,
      atRiskCount: 0,
      nps30d: null,
      npsResponses: 0,
      winbackSent: 0,
      winbackCampaigns: 0,
      openSuccessTasks: 0,
      overdueSuccessTasks: 0,
    };
    const modules = {};

    // --- Onboarding journeys (track 1) ---
    const MJ = m('memberJourney');
    if (MJ) {
      modules.journeys = true;
      stats.activeJourneys = await MJ.count({ where: { tenantId, status: 'active' } });
    }

    // --- Health score (track 2) ---
    const MH = m('memberHealth');
    if (MH) {
      modules.health = true;
      const rows = await MH.findMany({
        where: { tenantId },
        select: { score: true },
      });
      stats.healthSample = rows.length;
      if (rows.length) {
        const sum = rows.reduce((a, r) => a + toNum(r.score), 0);
        stats.avgHealthScore = Math.round(sum / rows.length);
        stats.atRiskCount = rows.filter((r) => toNum(r.score) < 40).length;
      }
    }

    // --- 30-day feedback NPS (track 6) ---
    const OF = m('onboardingFeedback');
    if (OF) {
      modules.feedback = true;
      const rows = await OF.findMany({
        where: { tenantId, submittedAt: { gte: d30 } },
        select: { score: true },
      });
      stats.npsResponses = rows.length;
      if (rows.length) {
        const promoters = rows.filter((r) => r.score >= 9).length;
        const detractors = rows.filter((r) => r.score <= 6).length;
        stats.nps30d = Math.round(((promoters - detractors) / rows.length) * 100);
      }
    }

    // --- Win-back campaigns (track 8) ---
    const WC = m('winbackCampaign');
    if (WC) {
      modules.winback = true;
      stats.winbackCampaigns = await WC.count({ where: { tenantId } });
      const sums = await WC.aggregate({
        where: { tenantId },
        _sum: { sentCount: true },
      }).catch(() => null);
      stats.winbackSent = sums && sums._sum ? toNum(sums._sum.sentCount) : 0;
    }

    // --- Success tasks (track 7) ---
    const ST = m('successTask');
    if (ST) {
      modules.tasks = true;
      stats.openSuccessTasks = await ST.count({
        where: { tenantId, status: { in: ['open', 'overdue'] } },
      });
      stats.overdueSuccessTasks = await ST.count({
        where: { tenantId, OR: [{ status: 'overdue' }, { status: 'open', dueAt: { lt: now } }] },
      }).catch(() => 0);
    }

    res.json({ ok: true, stats, modules });
  } catch (err) {
    next(err);
  }
});

// GET /api/success-dashboard/at-risk — sab se kam health walay members (top 10).
router.get('/at-risk', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;

    const MH = m('memberHealth');
    if (!MH) {
      return res.status(503).json({ ok: false, error: 'Health module abhi merge nahi hua (Phase 54 Track 2 pending)' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const rows = await MH.findMany({
      where: { tenantId },
      orderBy: { score: 'asc' },
      take: limit,
      include: {
        member: { select: { id: true, name: true, email: true } },
      },
    });

    // Journey status bhi sath (track 1 merge ho to)
    const MJ = m('memberJourney');
    let journeyMap = {};
    if (MJ && rows.length) {
      const memberIds = rows.map((r) => r.memberId).filter(Boolean);
      if (memberIds.length) {
        const journeys = await MJ.findMany({
          where: { tenantId, memberId: { in: memberIds } },
          select: { memberId: true, status: true, currentStage: true },
        });
        journeyMap = Object.fromEntries(journeys.map((j) => [j.memberId, j]));
      }
    }

    res.json({
      ok: true,
      atRisk: rows.map((r) => ({
        memberId: r.memberId,
        memberName: r.member?.name || null,
        memberEmail: r.member?.email || null,
        score: toNum(r.score),
        factors: r.factors || null,
        computedAt: r.computedAt || null,
        journey: journeyMap[r.memberId]
          ? { status: journeyMap[r.memberId].status, currentStage: journeyMap[r.memberId].currentStage }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
