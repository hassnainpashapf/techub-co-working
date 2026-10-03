// Phase 51 Track 8/10: Sustainability — green score + leaderboard.
// Mount (coordinator): app.use('/api/sustainability', require('./routes/sustainability'));
// Sidebar link nahi — utilities section extend hai.
// Koi migration nahi — UtilityMeter/MeterReading fragments merge hote hi live.
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const green = require('../lib/greenScore');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'ops'];

// Member resolution (my-access.js pattern)
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

// GET /api/sustainability/score — building score + CO2 + trend + tips
router.get('/score', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!green.hasModels()) {
      return res.status(503).json({ error: 'Sustainability module abhi tayyar nahi (migration pending)' });
    }
    const [score, carbon] = await Promise.all([
      green.buildingScore(tf.tenantId),
      green.carbonEstimate(tf.tenantId, 30),
    ]);
    const cons = await green.allConsumption(tf.tenantId, 30);
    const tips = green.buildTips({
      score: score.score,
      trendPct: score.trendPct,
      carbon: carbon.ok ? carbon : null,
      perMeter: cons.ok ? cons.perMeter : [],
    });
    // Member ke liye apni intensity bhi
    let myIntensity = null;
    const member = await myMember(req);
    if (member) {
      const mi = await green.memberIntensity(tf.tenantId, 30);
      if (mi.ok) {
        const me = mi.rows.find((r) => r.memberId === member.id);
        const rank = mi.rows.findIndex((r) => r.memberId === member.id);
        myIntensity = me ? { ...me, rank: rank + 1, of: mi.rows.length } : null;
      }
    }
    res.json({
      score: score.score,
      trendPct: score.trendPct,
      metersWithData: score.metersWithData || 0,
      carbonKg30d: carbon.ok ? carbon.totalKg : 0,
      carbonByType: carbon.ok ? carbon.byType : {},
      tips,
      myIntensity,
    });
  } catch (e) {
    console.error('sustainability/score', e);
    res.status(500).json({ error: 'Score nahi nikal saka' });
  }
});

// GET /api/sustainability/leaderboard — sab se green (kam istemal wale)
// Staff: poori list naam ke sath. Member: top 5 unit codes + apni rank.
router.get('/leaderboard', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    if (!green.hasModels()) {
      return res.status(503).json({ error: 'Sustainability module abhi tayyar nahi (migration pending)' });
    }
    const mi = await green.memberIntensity(tf.tenantId, 30);
    if (!mi.ok) return res.json({ rows: [], days: 30 });
    const roles = req.user.roles || [req.user.role].filter(Boolean);
    const isStaff = roles.some((r) => STAFF.includes(r));
    if (isStaff) {
      return res.json({ rows: mi.rows, days: mi.days });
    }
    // Member view: naam chhupao, unit codes + apni rank
    const member = await myMember(req);
    const rows = mi.rows.slice(0, 5).map((r, i) => ({
      rank: i + 1,
      label: r.units.join(', ') || 'Unit',
      consumption: r.consumption,
      isMe: member ? r.memberId === member.id : false,
    }));
    let myRank = null;
    if (member) {
      const idx = mi.rows.findIndex((r) => r.memberId === member.id);
      if (idx >= 0) myRank = { rank: idx + 1, of: mi.rows.length, consumption: mi.rows[idx].consumption };
    }
    res.json({ rows, myRank, days: mi.days });
  } catch (e) {
    console.error('sustainability/leaderboard', e);
    res.status(500).json({ error: 'Leaderboard nahi nikal saka' });
  }
});

module.exports = router;
