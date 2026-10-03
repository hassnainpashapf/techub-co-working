// Phase 40 Track 5: Gamification API — badges catalog, leaderboard, my badges.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { ensureBadges, runBadgeEngine } = require('../lib/badges');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

// Schema merge se pehle 503 guard.
function badgesEnabled(req, res, next) {
  if (!prisma.badge) return res.status(503).json({ error: 'Badges schema abhi merge nahi hua' });
  next();
}
router.use(badgesEnabled);

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

// GET /api/badges — catalog (har badge: earnedCount + meri earned state)
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const badges = await ensureBadges(req.user.tenantId);
    const member = await myMember(req);
    const myIds = new Set();
    if (member) {
      const mine = await prisma.memberBadge.findMany({
        where: { memberId: member.id, badge: { tenantId: req.user.tenantId } },
        select: { badgeId: true, awardedAt: true },
      });
      mine.forEach((m) => myIds.add(m.badgeId));
    }
    const withCounts = await Promise.all(
      badges.map(async (b) => ({
        id: b.id,
        key: b.key,
        name: b.name,
        description: b.description,
        icon: b.icon,
        earned: myIds.has(b.id),
        earnedCount: await prisma.memberBadge.count({ where: { badgeId: b.id } }),
      }))
    );
    res.json({ badges: withCounts });
  } catch (e) {
    next(e);
  }
});

// GET /api/badges/leaderboard — sab se zyada badges wale members
router.get('/leaderboard', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const rows = await prisma.member.findMany({
      where: tf,
      include: {
        memberBadges: { include: { badge: true }, orderBy: { awardedAt: 'desc' } },
      },
      take: 500,
    });
    const ranked = rows
      .map((m) => ({
        memberId: m.id,
        name: m.name,
        companyName: m.companyName || null,
        badgeCount: m.memberBadges.length,
        latest: m.memberBadges.slice(0, 3).map((mb) => ({ key: mb.badge.key, icon: mb.badge.icon, name: mb.badge.name })),
      }))
      .filter((r) => r.badgeCount > 0)
      .sort((a, b) => b.badgeCount - a.badgeCount)
      .slice(0, limit);
    res.json({ leaderboard: ranked });
  } catch (e) {
    next(e);
  }
});

// GET /api/badges/mine — logged-in member ke badges
router.get('/mine', async (req, res, next) => {
  try {
    const member = await myMember(req);
    if (!member) return res.json({ badges: [], member: null });
    const mine = await prisma.memberBadge.findMany({
      where: { memberId: member.id, badge: { tenantId: req.user.tenantId } },
      include: { badge: true },
      orderBy: { awardedAt: 'desc' },
    });
    res.json({
      member: { id: member.id, name: member.name },
      badges: mine.map((mb) => ({
        id: mb.id,
        key: mb.badge.key,
        name: mb.badge.name,
        description: mb.badge.description,
        icon: mb.badge.icon,
        awardedAt: mb.awardedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/badges/run — engine abhi chalao (staff, optional dryRun)
router.post('/run', staffOnly, async (req, res, next) => {
  try {
    const awarded = await runBadgeEngine(req.user.tenantId, { dryRun: !!req.body.dryRun });
    res.json({ awarded: awarded.length, dryRun: !!req.body.dryRun, details: awarded.slice(0, 50) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
