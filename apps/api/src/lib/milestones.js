// Phase 40 Track 8: Member Milestones — daily detector + celebrator.
//
// Detects: 100th booking, membership anniversaries (1/2/3+ yrs),
// 50th event attendance, 10th successful referral, 1000th loyalty point.
// On hit: audit-log dedupe (no migration), community announcement,
// in-app notification to the member, badge award (Track 5 lib, optional),
// loyalty bonus points.
//
// Coordinator wiring (server.js, additive):
//   app.use('/api/milestones', require('./routes/milestones'));
//   require('./lib/milestones');
//   require('./lib/milestones').ensureMilestonesScheduled();
const prisma = require('./prisma');
const jobs = require('./jobs');

const BONUS_POINTS = 100; // loyalty bonus per milestone

// Milestone definitions. `key` may be a function for repeating ones.
const MILESTONES = [
  {
    key: () => 'bookings_100',
    label: '100 Bookings',
    desc: (m) => `${m.name} ne 100 bookings mukammal kar lein!`,
    check: async (tenantId, m) => {
      const n = await prisma.booking.count({
        where: { tenantId, memberId: m.id, status: { not: 'cancelled' } },
      });
      return n >= 100;
    },
  },
  {
    key: (years) => `membership_anni_${years}`,
    label: 'Membership Anniversary',
    desc: (m, years) => `${m.name} ko ${years} saal member hue ho gaye!`,
    anniversary: true, // repeating — celebrated every year on the date
  },
  {
    key: () => 'events_50',
    label: '50 Events Attended',
    desc: (m) => `${m.name} ne 50 community events attend kiye!`,
    check: async (tenantId, m) => {
      // Prefer real check-ins (Track 6) when the model exists, else RSVPs.
      try {
        if (typeof prisma.eventCheckin !== 'undefined') {
          const n = await prisma.eventCheckin.count({ where: { tenantId, memberId: m.id } });
          return n >= 50;
        }
      } catch (e) { /* fall through to RSVP */ }
      const n = await prisma.eventRsvp.count({
        where: { tenantId, memberId: m.id, status: { not: 'cancelled' } },
      });
      return n >= 50;
    },
  },
  {
    key: () => 'referrals_10',
    label: '10 Referrals',
    desc: (m) => `${m.name} ne 10 members refer kiye — community builder!`,
    check: async (tenantId, m) => {
      const n = await prisma.referral.count({
        where: { tenantId, status: { in: ['joined', 'rewarded'] }, code: { memberId: m.id } },
      });
      return n >= 10;
    },
  },
  {
    key: () => 'points_1000',
    label: '1000 Loyalty Points',
    desc: (m) => `${m.name} ne 1000 loyalty points earn kiye!`,
    check: async (tenantId, m) => {
      try {
        const agg = await prisma.loyaltyLedger.aggregate({
          where: { tenantId, memberId: m.id, points: { gt: 0 } },
          _sum: { points: true },
        });
        return Number(agg._sum.points || 0) >= 1000;
      } catch (e) {
        return false;
      }
    },
  },
];

async function alreadyCelebrated(tenantId, memberId, key) {
  const row = await prisma.auditLog.findFirst({
    where: { tenantId, action: `milestone.${key}`, entity: 'Member', entityId: memberId },
    select: { id: true },
  });
  return !!row;
}

async function markCelebrated(tenantId, memberId, key, label) {
  await prisma.auditLog.create({
    data: { tenantId, action: `milestone.${key}`, entity: 'Member', entityId: memberId, newValue: { label } },
  });
}

async function celebrate(tenantId, member, key, label, desc) {
  const text = desc(member);
  // 1. Community announcement (in-app). sentBy: first staff user of the tenant.
  try {
    const staff = await prisma.user.findFirst({
      where: { tenantId, role: { in: ['ceo', 'admin', 'super_admin', 'manager'] }, isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (staff) {
      await prisma.announcement.create({
        data: {
          tenantId,
          title: `🎉 Milestone: ${label}`,
          body: text,
          audience: 'all',
          channels: ['inapp'],
          sentBy: staff.id,
          sentAt: new Date(),
        },
      });
    }
  } catch (e) { /* announcements table issue ho to milestone nahi rukta */ }

  // 2. Direct in-app notification to the member's linked user.
  try {
    const m = await prisma.member.findUnique({ where: { id: member.id }, include: { user: { select: { id: true } } } });
    if (m && m.user) {
      const { createNotification } = require('./notify');
      await createNotification(prisma, {
        tenantId,
        userId: m.user.id,
        type: 'general',
        message: `🎉 Mubarak! Aap ne milestone hasil kiya: ${label}. ${BONUS_POINTS} loyalty points mile hain!`,
      });
    }
  } catch (e) { /* ignore */ }

  // 3. Badge award (Track 5 lib) — maujood na ho to silently skip.
  try {
    const badges = require('./badges');
    if (badges && typeof badges.awardBadge === 'function') {
      await badges.awardBadge(tenantId, member.id, 'milestone_achiever');
    }
  } catch (e) { /* lib abhi merged nahi — skip */ }

  // 4. Loyalty bonus points.
  try {
    const { awardPoints } = require('./loyalty');
    await awardPoints(tenantId, member.id, BONUS_POINTS, `milestone:${key}`);
  } catch (e) { /* ignore */ }
}

function yearsSince(d) {
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  const md = now.getMonth() * 100 + now.getDate();
  const bd = d.getMonth() * 100 + d.getDate();
  if (md < bd) y -= 1;
  return y;
}

async function runMilestoneCheck(tenantId) {
  const results = [];
  const members = await prisma.member.findMany({
    where: { tenantId, status: 'active' },
    select: { id: true, name: true, createdAt: true },
  });
  const now = new Date();

  for (const m of members) {
    // Anniversary: month/day match karta hai aaj se, kam az kam 1 saal purana.
    const yrs = yearsSince(m.createdAt);
    if (yrs >= 1 && m.createdAt.getMonth() === now.getMonth() && m.createdAt.getDate() === now.getDate()) {
      const key = `membership_anni_${yrs}`;
      if (!(await alreadyCelebrated(tenantId, m.id, key))) {
        await markCelebrated(tenantId, m.id, key, 'Membership Anniversary');
        await celebrate(tenantId, m, key, 'Membership Anniversary', (mm) => `${mm.name} ko ${yrs} saal member hue ho gaye!`);
        results.push({ memberId: m.id, key });
      }
    }
    // Baqi one-time milestones.
    for (const def of MILESTONES.filter((d) => !d.anniversary)) {
      const key = typeof def.key === 'function' ? def.key() : def.key;
      if (await alreadyCelebrated(tenantId, m.id, key)) continue;
      try {
        if (await def.check(tenantId, m)) {
          await markCelebrated(tenantId, m.id, key, def.label);
          await celebrate(tenantId, m, key, def.label, def.desc);
          results.push({ memberId: m.id, key });
        }
      } catch (e) { /* model/table missing ho to skip, dobara try next run */ }
    }
  }
  return results;
}

async function runAllTenants() {
  const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
  let total = 0;
  for (const t of tenants) {
    try {
      const r = await runMilestoneCheck(t.id);
      total += r.length;
    } catch (e) { /* tenant-level failure se baqi nahi rukte */ }
  }
  return total;
}

// Recent milestones — community feed ke liye (audit logs se).
async function recentMilestones(tenantId, limit = 20) {
  const rows = await prisma.auditLog.findMany({
    where: { tenantId, entity: 'Member', action: { startsWith: 'milestone.' } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const memberIds = [...new Set(rows.map((r) => r.entityId).filter(Boolean))];
  const members = await prisma.member.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, name: true },
  });
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  return rows.map((r) => ({
    key: r.action.replace('milestone.', ''),
    label: (r.newValue && r.newValue.label) || r.action.replace('milestone.', ''),
    memberId: r.entityId,
    memberName: nameById[r.entityId] || 'Member',
    celebratedAt: r.createdAt,
  }));
}

// Daily scheduler wiring (docExpiryJob wali pattern).
async function processMilestones() {
  const total = await runAllTenants();
  await jobs.enqueue('milestones', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
  return total;
}

async function ensureMilestonesScheduled() {
  if (jobs && typeof jobs.registerHandler === 'function') {
    jobs.registerHandler('milestones', processMilestones);
  }
  const tonight = new Date();
  tonight.setHours(2, 30, 0, 0);
  if (tonight.getTime() < Date.now()) tonight.setDate(tonight.getDate() + 1);
  await jobs.enqueue('milestones', {}, { runAt: tonight });
}

module.exports = { runMilestoneCheck, runAllTenants, recentMilestones, ensureMilestonesScheduled, MILESTONES };
