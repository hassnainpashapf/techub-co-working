// Phase 40 Track 5: Gamification engine — badge award rules.
// Auto-registers 'badges-run' job handler; coordinator wires a daily enqueue.
const prisma = require('./prisma');
const { createNotification } = require('./notify');

let jobs;
try {
  jobs = require('./jobs');
} catch {
  jobs = null;
}

const BADGE_DEFS = [
  { key: 'early_bird', name: 'Early Bird', description: '30 din subah 9 bajay se pehle check-in', icon: '🌅', points: 100 },
  { key: 'event_regular', name: 'Event Regular', description: '5 community events attend kiye', icon: '🎉', points: 75 },
  { key: 'referrer', name: 'Top Referrer', description: '3 successful referrals', icon: '🤝', points: 150 },
  { key: 'super_connector', name: 'Super Connector', description: '10+ referrals join karwaye', icon: '🌐', points: 250 },
  { key: 'loyal_member', name: 'Loyal Member', description: '2 saal ki membership', icon: '🏆', points: 200 },
  { key: 'feedback_champion', name: 'Feedback Champion', description: '5 feedback posts', icon: '💡', points: 50 },
];

// Catalog ensure — idempotent (dedupe guard).
async function ensureBadges(tenantId) {
  const tx = [];
  for (const d of BADGE_DEFS) {
    tx.push(
      prisma.badge.upsert({
        where: { tenantId_key: { tenantId, key: d.key } },
        update: { name: d.name, description: d.description, icon: d.icon },
        create: { tenantId, key: d.key, name: d.name, description: d.description, icon: d.icon },
      })
    );
  }
  await Promise.all(tx);
  return prisma.badge.findMany({ where: { tenantId } });
}

// Ek member ko badge award (dedupe: @@unique badgeId+memberId).
async function awardBadge(tenantId, memberId, key, { silent = false } = {}) {
  try {
    await ensureBadges(tenantId);
    const badge = await prisma.badge.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!badge) return null;
    const existing = await prisma.memberBadge.findUnique({
      where: { badgeId_memberId: { badgeId: badge.id, memberId } },
    });
    if (existing) return existing;
    const awarded = await prisma.memberBadge.create({
      data: { badgeId: badge.id, memberId },
    });
    const def = BADGE_DEFS.find((d) => d.key === key);
    // Notification + loyalty points (fail-safe: award nahi rokti).
    try {
      const user = await prisma.user.findFirst({ where: { tenantId, memberId } });
      if (user) {
        await createNotification(prisma, {
          tenantId,
          userId: user.id,
          type: 'badge.earned',
          message: `🏅 "${badge.name}" badge mil gaya!`,
        });
      }
      const loyalty = require('./loyalty');
      if (loyalty && loyalty.awardPoints) {
        await loyalty.awardPoints(tenantId, memberId, def?.points || 50, 'badge', badge.id);
      }
    } catch {
      // notify/loyalty optional — award rehta hai
    }
    return awarded;
  } catch (e) {
    if (!silent) console.warn('[badges] award failed', e.message);
    return null;
  }
}

// All rules evaluate karo ek tenant ke liye.
async function runBadgeEngine(tenantId, { dryRun = false } = {}) {
  const awarded = [];
  const members = await prisma.member.findMany({
    where: { tenantId },
    select: { id: true, createdAt: true },
  });
  if (!members.length) return awarded;

  for (const member of members) {
    const mId = member.id;
    try {
      // early_bird: 30 distinct dates checkIn before 9am (attendance via linked user)
      const user = await prisma.user.findFirst({ where: { tenantId, memberId: mId }, select: { id: true } });
      if (user) {
        const recs = await prisma.attendanceRecord.findMany({
          where: { tenantId, userId: user.id, checkIn: { not: null } },
          select: { checkIn: true },
        });
        const earlyDays = new Set();
        for (const r of recs) {
          const d = new Date(r.checkIn);
          if (d.getHours() < 9) earlyDays.add(d.toISOString().slice(0, 10));
        }
        if (earlyDays.size >= 30) {
          if (!dryRun) await awardBadge(tenantId, mId, 'early_bird', { silent: true });
          awarded.push({ memberId: mId, key: 'early_bird' });
        }
      }
      // event_regular: 5 events attended (rsvp 'going', event completed)
      const attended = await prisma.eventRsvp.count({
        where: { memberId: mId, status: 'going', event: { tenantId, status: 'completed' } },
      });
      if (attended >= 5) {
        if (!dryRun) await awardBadge(tenantId, mId, 'event_regular', { silent: true });
        awarded.push({ memberId: mId, key: 'event_regular' });
      }
      // referrer: 3 successful referrals (joined/rewarded); super_connector: 10+
      let joined = 0;
      try {
        const codes = await prisma.referralCode.findMany({ where: { tenantId, memberId: mId }, select: { id: true } });
        if (codes.length) {
          joined = await prisma.referral.count({
            where: { codeId: { in: codes.map((c) => c.id) }, status: { in: ['joined', 'rewarded'] } },
          });
        }
      } catch {
        // referral module schema me nahi ho to skip
      }
      if (joined >= 10) {
        if (!dryRun) await awardBadge(tenantId, mId, 'super_connector', { silent: true });
        awarded.push({ memberId: mId, key: 'super_connector' });
      } else if (joined >= 3) {
        if (!dryRun) await awardBadge(tenantId, mId, 'referrer', { silent: true });
        awarded.push({ memberId: mId, key: 'referrer' });
      }
      // loyal_member: 2 years membership
      const years = (Date.now() - new Date(member.createdAt).getTime()) / (365 * 24 * 3600 * 1000);
      if (years >= 2) {
        if (!dryRun) await awardBadge(tenantId, mId, 'loyal_member', { silent: true });
        awarded.push({ memberId: mId, key: 'loyal_member' });
      }
      // feedback_champion: 5 feedback posts (non-anonymous)
      let fb = 0;
      try {
        fb = await prisma.feedback.count({ where: { tenantId, memberId: mId } });
      } catch {
        // feedback schema me nahi ho to skip
      }
      if (fb >= 5) {
        if (!dryRun) await awardBadge(tenantId, mId, 'feedback_champion', { silent: true });
        awarded.push({ memberId: mId, key: 'feedback_champion' });
      }
    } catch (e) {
      console.warn('[badges] rule eval failed for member', mId, e.message);
    }
  }
  return awarded;
}

// Job handler auto-register (daily enqueue coordinator kare).
if (jobs && jobs.registerHandler) {
  jobs.registerHandler('badges-run', async (payload = {}) => {
    const tenantId = payload.tenantId;
    if (tenantId) return runBadgeEngine(tenantId, { dryRun: payload.dryRun });
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    const out = [];
    for (const t of tenants) {
      try {
        out.push({ tenantId: t.id, awarded: (await runBadgeEngine(t.id, { dryRun: payload.dryRun })).length });
      } catch (e) {
        out.push({ tenantId: t.id, error: e.message });
      }
    }
    return out;
  });
}

module.exports = { BADGE_DEFS, ensureBadges, awardBadge, runBadgeEngine };
