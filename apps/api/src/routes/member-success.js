// Phase 54 Track 9/10: Member 360 Success View — sare Phase 54 success modules
// ka member-level aggregate. Koi migration nahi; tracks 1-8 ke models se compute.
// Sab sections defensive hain: model merge na hua ho to wo section null/empty,
// poora endpoint kabhi 500 nahi deta.
//
// COORDINATOR: server.js me (additive):
//   app.use('/api/member-success', require('./routes/member-success'));
// Sidebar link NAHI — member detail page par "Success" tab lagao:
//   apps/web/app/(app)/members/page.js me tabs array me 'success' joro:
//     ['overview', 'timeline', 'access', 'comms', 'success'] (+ button label '🌱 Success')
//   aur import karo: components/MemberSuccessTab.js
//   (coordinator ye component banaye — niche integration note me contract diya hai)
//
// MemberSuccessTab contract:
//   <MemberSuccessTab memberId={m.id} /> — GET /api/member-success/:memberId
//   response: { member, journey, health, buddy, feedback, openTasks, welcome, winback, modules }
//   Har section module missing ho to null/[] — UI me "—" ya hidden dikhao.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(
  authenticate,
  requireTenantUser,
  requireRole('ceo', 'admin', 'super_admin', 'manager')
);

// Model merge hua ya nahi (schema merge se pehle prisma.<model> undefined hota hai).
function m(name) {
  return prisma[name] || null;
}

// GET /api/member-success/:memberId — member ka 360 success snapshot.
router.get('/:memberId', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;
    const { memberId } = req.params;

    const result = {
      member: null,
      journey: null,   // track 1: MemberJourney
      health: null,    // track 2: MemberHealth
      buddy: null,     // track 4: BuddyPair
      feedback: null,  // track 6: OnboardingFeedback
      openTasks: [],   // track 7: SuccessTask
      welcome: null,   // track 3: WelcomeLog
      winback: { eligible: false, reasons: [] }, // track 8
      modules: {},     // kon se Phase 54 modules live hain
    };

    // --- Member basic (tenant-scoped) ---
    const MEM = m('member');
    if (MEM) {
      result.member = await MEM.findFirst({
        where: { id: memberId, tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
        },
      });
      if (!result.member) {
        return res.status(404).json({ error: 'Member not found' });
      }
    }

    // --- Track 1: Onboarding journey (latest) ---
    const MJ = m('memberJourney');
    if (MJ) {
      result.modules.journey = true;
      try {
        result.journey = await MJ.findFirst({
          where: { tenantId, memberId },
          orderBy: { startedAt: 'desc' },
        });
      } catch {
        result.modules.journey = false;
      }
    }

    // --- Track 2: Health score ---
    const MH = m('memberHealth');
    if (MH) {
      result.modules.health = true;
      try {
        result.health = await MH.findFirst({ where: { memberId } });
      } catch {
        result.modules.health = false;
      }
    }

    // --- Track 4: Buddy/mentor pairs ---
    const BP = m('buddyPair');
    if (BP) {
      result.modules.buddy = true;
      try {
        const asNewcomer = await BP.findMany({
          where: { tenantId, newcomerId: memberId, status: 'active' },
        });
        const asBuddy = await BP.findMany({
          where: { tenantId, buddyId: memberId, status: 'active' },
        });
        // Naam resolve — relation names track 4 ke fragment se aate hain,
        // is liye member model se alag se lao (koi guess relation include nahi).
        const names = {};
        if (MEM) {
          const ids = [
            ...new Set([
              ...asNewcomer.map((p) => p.buddyId),
              ...asBuddy.map((p) => p.newcomerId),
            ]),
          ].filter(Boolean);
          if (ids.length) {
            const people = await MEM.findMany({
              where: { tenantId, id: { in: ids } },
              select: { id: true, name: true },
            });
            for (const p of people) names[p.id] = p.name;
          }
        }
        result.buddy = {
          asNewcomer: asNewcomer.map((p) => ({
            ...p,
            buddyName: names[p.buddyId] || null,
          })),
          asBuddy: asBuddy.map((p) => ({
            ...p,
            newcomerName: names[p.newcomerId] || null,
          })),
        };
      } catch {
        result.modules.buddy = false;
      }
    }

    // --- Track 6: 30-day onboarding feedback ---
    const FB = m('onboardingFeedback');
    if (FB) {
      result.modules.feedback = true;
      try {
        result.feedback = await FB.findFirst({
          where: { memberId },
          orderBy: { submittedAt: 'desc' },
        });
      } catch {
        result.modules.feedback = false;
      }
    }

    // --- Track 7: Open success tasks ---
    const ST = m('successTask');
    if (ST) {
      result.modules.tasks = true;
      try {
        result.openTasks = await ST.findMany({
          where: { tenantId, memberId, status: 'open' },
          orderBy: { dueAt: 'asc' },
        });
      } catch {
        result.modules.tasks = false;
        result.openTasks = [];
      }
    }

    // --- Track 3: Welcome sequence progress ---
    const WL = m('welcomeLog');
    if (WL) {
      result.modules.welcome = true;
      try {
        const logs = await WL.findMany({
          where: { memberId },
          orderBy: { sentAt: 'desc' },
        });
        result.welcome = { stepsSent: logs.length, log: logs };
      } catch {
        result.modules.welcome = false;
      }
    }

    // --- Track 8: Winback eligibility ---
    // Rule: 60+ din se koi booking ya payment nahi → eligible.
    const BK = m('booking');
    const PY = m('payment');
    if (BK || PY) {
      result.modules.winback = true;
      try {
        const d60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        let recentActivity = 0;
        if (BK) {
          recentActivity += await BK.count({
            where: { tenantId, memberId, createdAt: { gte: d60 } },
          });
        }
        if (PY) {
          recentActivity += await PY.count({
            where: { tenantId, memberId, createdAt: { gte: d60 } },
          });
        }
        if (recentActivity === 0) {
          result.winback.eligible = true;
          result.winback.reasons.push(
            '60+ din se koi booking ya payment nahi'
          );
        }
      } catch {
        // Field naam track mismatch — eligibility unknown, crash nahi.
        result.modules.winback = false;
      }
    }

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
