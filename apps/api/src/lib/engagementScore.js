// Member Engagement Score — simple, explainable heuristic (koi ML nahi).
// Har signal ke points documented hain; GET /api/engagement breakdown deta hai.
// Phase 35 ka churn score "risk" measure karta hai (overdue invoices, contract
// expiry...); ye score "engagement" measure karta hai (bookings, events,
// feedback, referrals, login recency) — dono alag metrics hain.

const prisma = require('./prisma');

const DAY = 24 * 60 * 60 * 1000;

const TIER = {
  champion: { min: 80, label: 'Champion' },
  active: { min: 60, label: 'Active' },
  casual: { min: 40, label: 'Casual' },
  'at-risk': { min: 0, label: 'At-risk' },
};

function tierFor(score) {
  if (score >= 80) return 'champion';
  if (score >= 60) return 'active';
  if (score >= 40) return 'casual';
  return 'at-risk';
}

/**
 * computeEngagement(member) -> { score, tier, breakdown }
 * member: object with optional arrays (bookings, eventRsvps, eventCheckins,
 *   feedback, surveyResponses, pollVotes, referrals) + optional userId.
 * Pure function — testing ke liye mock data par bhi chalti hai.
 */
function computeEngagement(member) {
  const breakdown = [];
  let score = 0;

  const add = (label, points) => {
    if (!points) return;
    score += points;
    breakdown.push({ label, points });
  };

  const n = (arr) => (Array.isArray(arr) ? arr.length : 0);

  // 1. Bookings (last 30 days) — 0..30 (har booking 6 pts, 5 par full)
  const bookingCount = n(member.bookings);
  add(`${bookingCount} bookings (pichlay 30 din)`, Math.min(30, bookingCount * 6));

  // 2. Event attendance (last 90 days) — 0..20 (har event 5 pts, 4 par full)
  // Track 6 ke EventCheckin merge ho jayein to asal check-ins, warna RSVP 'going' proxy.
  const eventCount = n(member.eventCheckins) || n(member.eventRsvps);
  add(`${eventCount} events (pichlay 90 din)`, Math.min(20, eventCount * 5));

  // 3. Feedback / polls participation (last 90 days) — 0..15
  const fbPts = Math.min(9, n(member.feedback) * 3);
  const pollPts = Math.min(6, (n(member.surveyResponses) + n(member.pollVotes)) * 3);
  add(`Feedback/survey/polls (${n(member.feedback)}+${n(member.surveyResponses) + n(member.pollVotes)})`, fbPts + pollPts);

  // 4. Referrals (joined ya rewarded) — 0..15 (har referral 5 pts)
  const refCount = (Array.isArray(member.referrals) ? member.referrals : []).filter((r) =>
    ['joined', 'rewarded'].includes(String(r.status || '').toLowerCase())
  ).length;
  add(`${refCount} successful referrals`, Math.min(15, refCount * 5));

  // 5. App login recency — 0..20
  if (member.lastActiveAt) {
    const days = (Date.now() - new Date(member.lastActiveAt).getTime()) / DAY;
    if (days <= 1) add('Aaj/kal login kiya', 20);
    else if (days <= 7) add('Pichlay haftay login kiya', 15);
    else if (days <= 14) add('Pichlay 2 hafton me login', 10);
    else if (days <= 30) add('Pichlay mahine login', 5);
    else add('30+ din se login nahi', 0);
  } else {
    breakdown.push({ label: 'Koi app login record nahi', points: 0 });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = tierFor(score);

  // lastActivityAt: at-risk list me "last active" dikhane ke liye.
  const times = [];
  if (member.lastActiveAt) times.push(new Date(member.lastActiveAt).getTime());
  if (member.bookings) for (const b of member.bookings) if (b.createdAt) times.push(new Date(b.createdAt).getTime());
  if (member.eventRsvps) for (const r of member.eventRsvps) if (r.createdAt) times.push(new Date(r.createdAt).getTime());
  if (member.createdAt) times.push(new Date(member.createdAt).getTime());
  const lastActivityAt = times.length ? new Date(Math.max(...times)) : null;

  return { score, tier, tierLabel: TIER[tier].label, breakdown, lastActivityAt };
}

/**
 * fetchEngagementData(tenantId) -> members[] with engagement data
 * Ek batched include query + sessions lookup; per-member scoring computeEngagement se.
 */
async function fetchEngagementData(tenantId) {
  const now = Date.now();
  const cutoff30 = new Date(now - 30 * DAY);
  const cutoff90 = new Date(now - 90 * DAY);

  const members = await prisma.member.findMany({
    where: { tenantId, status: { not: 'suspended' } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      companyName: true,
      createdAt: true,
      userId: true,
      bookings: {
        where: { startAt: { gte: cutoff30 }, status: { not: 'cancelled' } },
        select: { id: true, createdAt: true },
      },
      eventRsvps: {
        where: { status: 'going', event: { startsAt: { gte: cutoff90 } } },
        select: { id: true, createdAt: true },
      },
      feedback: { where: { createdAt: { gte: cutoff90 } }, select: { id: true } },
      surveyResponses: { where: { createdAt: { gte: cutoff90 } }, select: { id: true } },
      referralCodes: { select: { referrals: { select: { id: true, status: true } } } },
    },
    take: 500,
  });

  // Optional models (parallel Phase 40 tracks ne abhi merge nahi kiye to skip).
  const checkinCounts = {};
  if (prisma.eventCheckin) {
    try {
      const rows = await prisma.eventCheckin.groupBy({
        by: ['memberId'],
        where: { tenantId, checkedInAt: { gte: cutoff90 } },
        _count: { _all: true },
      });
      for (const r of rows) checkinCounts[r.memberId] = r._count._all;
    } catch {}
  }
  const pollCounts = {};
  if (prisma.pollVote) {
    try {
      const rows = await prisma.pollVote.groupBy({
        by: ['memberId'],
        where: { tenantId, votedAt: { gte: cutoff90 } },
        _count: { _all: true },
      });
      for (const r of rows) pollCounts[r.memberId] = r._count._all;
    } catch {}
  }

  // Login recency: member → user → latest UserSession.
  const userIds = members.map((m) => m.userId).filter(Boolean);
  const lastActive = {};
  if (userIds.length && prisma.userSession) {
    try {
      const sessions = await prisma.userSession.findMany({
        where: { userId: { in: userIds }, revokedAt: null },
        orderBy: { lastActiveAt: 'desc' },
        select: { userId: true, lastActiveAt: true },
        take: userIds.length * 2,
      });
      for (const s of sessions) {
        if (!lastActive[s.userId]) lastActive[s.userId] = s.lastActiveAt;
      }
    } catch {}
  }

  return members.map((m) => {
    const memberLike = {
      bookings: m.bookings,
      eventRsvps: m.eventRsvps,
      eventCheckins: checkinCounts[m.id] ? new Array(checkinCounts[m.id]).fill({}) : [],
      feedback: m.feedback,
      surveyResponses: m.surveyResponses,
      pollVotes: pollCounts[m.id] ? new Array(pollCounts[m.id]).fill({}) : [],
      referrals: m.referralCodes.flatMap((c) => c.referrals),
      lastActiveAt: m.userId ? lastActive[m.userId] || null : null,
      createdAt: m.createdAt,
    };
    const { score, tier, tierLabel, breakdown, lastActivityAt } = computeEngagement(memberLike);
    return {
      id: m.id,
      name: m.name,
      email: m.email,
      phone: m.phone,
      companyName: m.companyName,
      score,
      tier,
      tierLabel,
      breakdown,
      lastActivityAt,
    };
  });
}

module.exports = { computeEngagement, tierFor, fetchEngagementData, TIER };
