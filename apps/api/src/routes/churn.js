// Phase 35 Track 5/10: Member Churn Analysis — churn rate (90d) + monthly
// exit trend + heuristic at-risk scoring (0-100) with reasons, and a
// "send retention offer" quick action.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { notify } = require('../lib/mailer');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

const DAY = 86400000;

// Risk weights (simple documented heuristic, 0-100).
const W = {
  overdue_invoices: 30,
  no_recent_bookings: 20,
  no_recent_attendance: 15,
  contract_expiring: 20,
  nps_detractor: 15,
};
const AT_RISK_THRESHOLD = 25;

const REASON_LABELS = {
  overdue_invoices: 'Overdue invoices',
  no_recent_bookings: 'No bookings in 30 days',
  no_recent_attendance: 'No check-ins in 30 days',
  contract_expiring: 'Contract expiring soon',
  nps_detractor: 'NPS detractor',
};

router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const now = new Date();
    const cutoff90 = new Date(now.getTime() - 90 * DAY);
    const cutoff30 = new Date(now.getTime() - 30 * DAY);
    const contractCutoff = new Date(now.getTime() + 30 * DAY);

    // ---- Churn rate: exited in last 90d / all members ----
    const [exited90d, totalMembers, exitedAll] = await Promise.all([
      prisma.member.count({ where: { ...tf, status: 'exited', updatedAt: { gte: cutoff90 } } }),
      prisma.member.count({ where: { ...tf } }),
      prisma.member.findMany({
        where: { ...tf, status: 'exited' },
        select: { updatedAt: true },
      }),
    ]);
    const churnRate90d = totalMembers > 0 ? Math.round((exited90d / totalMembers) * 1000) / 10 : 0;

    // ---- Monthly exit trend (last 6 calendar months) ----
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      trend.push({ month: key, label: d.toLocaleString('en', { month: 'short' }), exited: 0 });
    }
    const trendIndex = {};
    trend.forEach((t, i) => { trendIndex[t.month] = i; });
    for (const m of exitedAll) {
      const key = `${m.updatedAt.getFullYear()}-${String(m.updatedAt.getMonth() + 1).padStart(2, '0')}`;
      if (trendIndex[key] !== undefined) trend[trendIndex[key]].exited += 1;
    }

    // ---- At-risk scoring for currently active members ----
    const members = await prisma.member.findMany({
      where: { ...tf, status: { in: ['active', 'trial', 'on_hold'] } },
      select: {
        id: true,
        name: true,
        email: true,
        companyName: true,
        status: true,
        user: { select: { id: true } },
        invoices: {
          where: { status: { in: ['unpaid', 'partial', 'overdue'] }, dueDate: { lt: now } },
          select: { amount: true, amountPaid: true, dueDate: true },
        },
        bookings: {
          where: { status: 'confirmed', startAt: { gte: cutoff30 } },
          select: { id: true },
          take: 1,
        },
        contracts: {
          where: { status: 'active', endDate: { lte: contractCutoff, gte: now } },
          select: { id: true, endDate: true },
          take: 1,
        },
        surveyResponses: {
          orderBy: { createdAt: 'desc' },
          select: { score: true },
          take: 1,
        },
      },
    });

    const userIds = members.map((m) => m.user && m.user.id).filter(Boolean);
    const recentAttendance = new Set();
    if (userIds.length) {
      const rows = await prisma.attendanceRecord.findMany({
        where: { ...tf, userId: { in: userIds }, date: { gte: cutoff30 } },
        select: { userId: true },
      });
      rows.forEach((r) => recentAttendance.add(r.userId));
    }

    const atRisk = [];
    for (const m of members) {
      const reasons = [];
      let score = 0;

      const overdueTotal = m.invoices.reduce(
        (s, inv) => s + (Number(inv.amount) - Number(inv.amountPaid)),
        0
      );
      if (m.invoices.length > 0 && overdueTotal > 0) {
        score += W.overdue_invoices;
        reasons.push({
          code: 'overdue_invoices',
          label: REASON_LABELS.overdue_invoices,
          detail: `${m.invoices.length} overdue · Rs ${Math.round(overdueTotal).toLocaleString()}`,
        });
      }
      if (m.bookings.length === 0) {
        score += W.no_recent_bookings;
        reasons.push({ code: 'no_recent_bookings', label: REASON_LABELS.no_recent_bookings });
      }
      if (m.user && !recentAttendance.has(m.user.id)) {
        score += W.no_recent_attendance;
        reasons.push({ code: 'no_recent_attendance', label: REASON_LABELS.no_recent_attendance });
      }
      if (m.contracts.length > 0) {
        const end = new Date(m.contracts[0].endDate);
        const days = Math.ceil((end - now) / DAY);
        score += W.contract_expiring;
        reasons.push({
          code: 'contract_expiring',
          label: REASON_LABELS.contract_expiring,
          detail: `ends in ${days} day${days === 1 ? '' : 's'}`,
        });
      }
      const latest = m.surveyResponses[0];
      if (latest && latest.score != null && latest.score <= 6) {
        score += W.nps_detractor;
        reasons.push({
          code: 'nps_detractor',
          label: REASON_LABELS.nps_detractor,
          detail: `score ${latest.score}/10`,
        });
      }

      score = Math.min(score, 100);
      if (score >= AT_RISK_THRESHOLD) {
        atRisk.push({
          memberId: m.id,
          memberName: m.name,
          email: m.email,
          companyName: m.companyName,
          status: m.status,
          riskScore: score,
          reasons,
        });
      }
    }
    atRisk.sort((a, b) => b.riskScore - a.riskScore);

    return res.json({
      churnRate90d,
      exitedCount90d: exited90d,
      totalMembers,
      trend,
      atRisk,
      weights: W,
      threshold: AT_RISK_THRESHOLD,
    });
  } catch (err) {
    return next(err);
  }
});

// Quick action: send a retention offer email to an at-risk member.
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
      action: 'churn.retention_offer_sent',
      entity: 'member',
      entityId: member.id,
    }).catch(() => {});

    return res.json({ sent: !!(result && (result.sent || result.queued)), result });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
