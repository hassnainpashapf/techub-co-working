// Phase 54 Track 2: Member Health Score — lib.
// Mount/route kuch nahi banata; routes/health.js isay use karta hai.
// Job wiring (coordinator, server.js additive):
//   require('./lib/healthScore').ensureHealthScheduled();
//
// Health score 0..100 — 4 factors, weighted:
//   bookings   30% — aakhri 30 din me kitni bookings (target 6/mo)
//   payments   30% — invoices ki on-time payment ratio (aakhri 6 invoices)
//   attendance 20% — aakhri 30 din me check-ins (target 22 workdays)
//   engagement 20% — events (RSVP/checkin) + poll votes, aakhri 60 din

const prisma = require('./prisma');

const DAY = 24 * 60 * 60 * 1000;

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

async function computeHealth(tenantId, memberId) {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since60 = new Date(now.getTime() - 60 * DAY);

  const member = await prisma.member.findFirst({
    where: { id: memberId, tenantId },
    select: { id: true, email: true, status: true },
  });
  if (!member) return null;

  // 1) Bookings frequency (30d)
  let bookingsScore = 0, bookingsCount = 0;
  try {
    bookingsCount = await prisma.booking.count({
      where: { tenantId, memberId, startAt: { gte: since30 }, status: { not: 'cancelled' } },
    });
    bookingsScore = Math.round(clamp01(bookingsCount / 6) * 100);
  } catch { /* model/table missing */ }

  // 2) Payment timeliness — aakhri 6 invoices
  let paymentsScore = 0, paidOnTime = 0, invCount = 0, overdueCount = 0;
  try {
    const invoices = await prisma.invoice.findMany({
      where: { tenantId, memberId },
      orderBy: { dueDate: 'desc' },
      take: 6,
      select: { id: true, dueDate: true, amount: true, amountPaid: true, status: true },
    });
    invCount = invoices.length;
    for (const inv of invoices) {
      const paid = Number(inv.amountPaid) >= Number(inv.amount);
      if (paid) {
        const lastPay = await prisma.payment.findFirst({
          where: { tenantId, invoiceId: inv.id },
          orderBy: { paidAt: 'desc' },
          select: { paidAt: true },
        }).catch(() => null);
        if (!lastPay || new Date(lastPay.paidAt) <= new Date(inv.dueDate)) paidOnTime++;
      } else if (new Date(inv.dueDate) < now) {
        overdueCount++;
      }
    }
    paymentsScore = invCount > 0 ? Math.round((paidOnTime / invCount) * 100) : 50; // koi invoice nahi → neutral
  } catch { paymentsScore = 50; }

  // 3) Attendance rate — member ka linked user (email match)
  let attendanceScore = 50, checkins = 0, userLinked = false;
  try {
    if (member.email) {
      const user = await prisma.user.findFirst({
        where: { tenantId, email: member.email },
        select: { id: true },
      });
      if (user) {
        userLinked = true;
        checkins = await prisma.attendanceRecord.count({
          where: { tenantId, userId: user.id, date: { gte: since30 }, checkIn: { not: null } },
        });
        attendanceScore = Math.round(clamp01(checkins / 22) * 100);
      }
    }
  } catch { attendanceScore = 50; }

  // 4) Community engagement (60d): event RSVPs + checkins + poll votes
  let engagementScore = 0, engagementCount = 0;
  try {
    const [rsvps, checkinsEv, votes] = await Promise.all([
      prisma.eventRsvp.count({ where: { memberId, createdAt: { gte: since60 }, status: { in: ['going', 'interested'] } } }).catch(() => 0),
      prisma.eventCheckin.count({ where: { memberId, checkedInAt: { gte: since60 } } }).catch(() => 0),
      prisma.pollVote.count({ where: { tenantId, memberId, votedAt: { gte: since60 } } }).catch(() => 0),
    ]);
    engagementCount = rsvps + checkinsEv + votes;
    engagementScore = Math.round(clamp01(engagementCount / 4) * 100);
  } catch { /* tables missing */ }

  const score = Math.round(
    bookingsScore * 0.3 + paymentsScore * 0.3 + attendanceScore * 0.2 + engagementScore * 0.2
  );

  const factors = {
    bookings: bookingsScore,
    payments: paymentsScore,
    attendance: attendanceScore,
    engagement: engagementScore,
    detail: {
      bookings30d: bookingsCount,
      invoicesChecked: invCount,
      paidOnTime,
      overdue: overdueCount,
      checkins30d: checkins,
      userLinked,
      engagementActions60d: engagementCount,
    },
  };

  let saved = null;
  try {
    saved = await prisma.memberHealth.upsert({
      where: { memberId },
      update: { score, factors, tenantId },
      create: { tenantId, memberId, score, factors },
    });
  } catch { /* schema merge se pehle */ }

  return { memberId, score, factors, computedAt: saved ? saved.computedAt : now };
}

// Sab active members ka recompute (tenant)
async function recomputeTenant(tenantId) {
  let done = 0;
  try {
    const members = await prisma.member.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true },
    });
    for (const m of members) {
      try {
        await computeHealth(tenantId, m.id);
        done++;
      } catch { /* aglay member par */ }
    }
  } catch { /* tables missing */ }
  return { tenantId, recomputed: done };
}

// Daily job — coordinator server.js me ensureHealthScheduled() lagaye
async function ensureHealthScheduled() {
  try {
    const jobs = require('./jobs');
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'member-health-scan', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      await jobs.enqueue('member-health-scan', {}, { runAt: new Date(Date.now() + DAY), repeat: 'daily' }).catch(() => {});
    }
  } catch { /* jobs lib na ho */ }
}

module.exports = { computeHealth, recomputeTenant, ensureHealthScheduled };
