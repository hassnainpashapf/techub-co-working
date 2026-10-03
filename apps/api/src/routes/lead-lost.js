// Phase 39 Track 8: Lost-lead analysis.
// Separate router mounted alongside the existing leads router:
//   coordinator: app.use('/api/leads', require('./routes/lead-lost'));  (additive — existing app.use('/api/leads', ...) untouched)
// Endpoints:
//   POST /:id/lost      — mark a lead lost (lostReason LAZMI), sets lostAt, audit trail.
//   GET  /lost-analysis — reason-wise counts, funnel drop-off, source-wise loss rate,
//                         avg days-to-lost. Roles: ceo/admin/super_admin/manager.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const ANALYSIS_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const SALES_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const salesWrite = requireRole(...SALES_ROLES);
const analysisRead = requireRole(...ANALYSIS_ROLES);

const LOST_REASONS = ['price', 'location', 'timing', 'competitor', 'no_response', 'other'];
const REASON_LABELS = {
  price: 'Too expensive',
  location: 'Location not suitable',
  timing: 'Timing not right',
  competitor: 'Chose competitor',
  no_response: 'No response',
  other: 'Other / unspecified',
};

const markLostSchema = z.object({
  lostReason: z.enum(LOST_REASONS, { errorMap: () => ({ message: 'lostReason is required: price | location | timing | competitor | no_response | other' }) }),
  note: z.string().max(2000).optional().nullable(),
});

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'Lead',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

// GET /lost-analysis?days=90 — lost-lead dashboard aggregates.
// NOTE: defined BEFORE any /:id routes so it isn't swallowed by a param matcher.
router.get('/lost-analysis', analysisRead, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 1), 730);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const tenant = tenantFilter(req);

    // All lost leads in window (lostAt set, or stage=lost without lostAt — legacy)
    const lost = await prisma.lead.findMany({
      where: {
        ...tenant,
        stage: 'lost',
        OR: [{ lostAt: { gte: cutoff } }, { AND: [{ lostAt: null }, { updatedAt: { gte: cutoff } }] }],
      },
      select: { id: true, source: true, stage: true, lostReason: true, lostAt: true, createdAt: true },
    });

    // Reason-wise counts (NULL/legacy reason -> 'other')
    const byReason = LOST_REASONS.map((r) => ({
      reason: r,
      label: REASON_LABELS[r],
      count: lost.filter((l) => (l.lostReason || 'other') === r).length,
    }));
    const totalLost = lost.length;

    // Source-wise loss rate: lost / all leads per source in window
    const allInWindow = await prisma.lead.groupBy({
      by: ['source'],
      where: { ...tenant, createdAt: { gte: cutoff } },
      _count: { _all: true },
    });
    const lostInWindowBySource = lost.reduce((m, l) => {
      m[l.source] = (m[l.source] || 0) + 1;
      return m;
    }, {});
    const bySource = allInWindow.map((g) => {
      const lostCount = lostInWindowBySource[g.source] || 0;
      const total = g._count._all;
      return {
        source: g.source,
        lost: lostCount,
        total,
        lossRate: total ? +( (lostCount / total) * 100 ).toFixed(1) : 0,
      };
    }).sort((a, b) => b.lossRate - a.lossRate);

    // Funnel drop-off: current stage distribution of all leads created in window
    // (includes leads still open + lost). Lost ones show at the end of the funnel.
    const funnel = await prisma.lead.groupBy({
      by: ['stage'],
      where: { ...tenant, createdAt: { gte: cutoff } },
      _count: { _all: true },
    });
    const funnelCounts = funnel.reduce((m, g) => {
      m[g.stage] = g._count._all;
      return m;
    }, {});
    const totalInWindow = Object.values(funnelCounts).reduce((a, b) => a + b, 0);
    const FUNNEL_ORDER = ['new', 'contacted', 'visit', 'booked', 'lost'];
    const orderedStages = [...new Set([...FUNNEL_ORDER, ...Object.keys(funnelCounts)])];
    const funnelData = orderedStages.map((stage) => ({
      stage,
      count: funnelCounts[stage] || 0,
      pct: totalInWindow ? +((funnelCounts[stage] || 0) / totalInWindow * 100).toFixed(1) : 0,
    }));

    // Avg days to lost
    const withDates = lost.filter((l) => l.lostAt && l.createdAt);
    const avgDaysToLost = withDates.length
      ? +(withDates.reduce((s, l) => s + (new Date(l.lostAt) - new Date(l.createdAt)) / 86400000, 0) / withDates.length).toFixed(1)
      : null;

    // Insights (auto-generated, plain language)
    const insights = [];
    const topReason = byReason.slice().sort((a, b) => b.count - a.count)[0];
    if (topReason && totalLost > 0) {
      const pct = Math.round((topReason.count / totalLost) * 100);
      if (topReason.reason === 'price')
        insights.push(`${pct}% lost leads ki wajah price hai — pricing plans aur discounts review karo.`);
      else if (topReason.reason === 'location')
        insights.push(`${pct}% leads location ki wajah se gaye — marketing ko target areas me focus karo.`);
      else if (topReason.reason === 'timing')
        insights.push(`${pct}% leads timing ki wajah se gaye — in ko follow-up list me rakho aur baad me dobara contact karo.`);
      else if (topReason.reason === 'competitor')
        insights.push(`${pct}% leads competitor ke paas gaye — USPs (facilities, pricing, flexibility) ko pitch me mazboot karo.`);
      else if (topReason.reason === 'no_response')
        insights.push(`${pct}% leads ne jawab hi nahi diya — follow-up sequence (Track 5 reminders) ko check karo.`);
      else
        insights.push(`Sab se bara lost reason "${topReason.label}" hai (${pct}%) — is category ke notes parh kar pattern nikalo.`);
    }
    const worstSource = bySource[0];
    if (worstSource && worstSource.total >= 3 && worstSource.lossRate >= 30)
      insights.push(`"${worstSource.source}" source se loss rate sab se zyada hai (${worstSource.lossRate}%) — is channel ki lead quality check karo.`);
    if (avgDaysToLost != null && avgDaysToLost > 30)
      insights.push(`Leads average ${avgDaysToLost} din baad lost hote hain — pipeline me zyada der na rakho, tez follow-up karo.`);
    if (totalLost === 0)
      insights.push(`Is period me koi lead lost nahi hui — pipeline healthy hai.`);

    res.json({
      window: { days, since: cutoff.toISOString() },
      totalLost,
      avgDaysToLost,
      byReason,
      bySource,
      funnel: funnelData,
      insights,
    });
  } catch (e) { next(e); }
});

// POST /:id/lost — mark a lead lost. lostReason LAZMI hai.
router.post('/:id/lost', salesWrite, validateBody(markLostSchema), async (req, res, next) => {
  try {
    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });
    if (existing.stage === 'lost') return res.status(400).json({ error: 'Lead is already marked lost' });

    const { lostReason, note } = req.body;
    const notes = note
      ? (existing.notes ? `${existing.notes}\n\n[Lost: ${REASON_LABELS[lostReason]}] ${note}` : `[Lost: ${REASON_LABELS[lostReason]}] ${note}`)
      : existing.notes;

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { stage: 'lost', lostReason, lostAt: new Date(), notes },
    });
    await audit(req, 'lead.mark_lost', lead.id, { name: lead.name, lostReason, lostAt: lead.lostAt });
    res.json({ lead });
  } catch (e) { next(e); }
});

module.exports = router;
