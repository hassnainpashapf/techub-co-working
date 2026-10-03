// Phase 29 Track 3: Leads CRM — kanban pipeline for prospective members.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
// Phase 39 Track 7: reuse member-flow helpers, webhooks and welcome email.
const { checkLimit } = require('../lib/limits');
const { emitWebhook } = require('../lib/webhooks');
const { notify } = require('../lib/mailer');
const { computeLeadScore } = require('../lib/leadScoring');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const SALES_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const salesWrite = requireRole(...SALES_ROLES);

// Phase 29 stages kept for kanban compat; Phase 39 adds the sales-pipeline stages.
const STAGES = ['new', 'contacted', 'visit', 'booked', 'lost', 'tour_scheduled', 'quoted', 'negotiating', 'won'];
const SOURCES = ['walkin', 'website', 'referral', 'social', 'other'];
const ACTIVITY_TYPES = ['call', 'email', 'tour', 'note', 'stage_change'];

const leadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  source: z.enum(SOURCES).optional(),
  interest: z.string().optional().nullable(),
  interestedIn: z.string().optional().nullable(), // Phase 39 alias for interest
  budget: z.number().nonnegative().optional().nullable(),
  stage: z.enum(STAGES).optional(),
  score: z.number().int().min(0).max(100).optional(), // Phase 39: lead score (Track 6)
  notes: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
});

// Map frontend alias `interestedIn` onto the persisted `interest` column.
function normalizeLeadInput(body) {
  const { interestedIn, ...rest } = body || {};
  const data = { ...rest };
  if (interestedIn && !data.interest) data.interest = interestedIn;
  return data;
}

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

// List leads (?stage=, ?source=, ?assignedTo=, ?search=)
router.get('/', async (req, res, next) => {
  try {
    const { stage, source, assignedTo, search, sort } = req.query;
    const where = { ...tenantFilter(req) };
    if (stage && STAGES.includes(stage)) where.stage = stage;
    if (source && SOURCES.includes(source)) where.source = source;
    if (assignedTo === 'unassigned') {
      where.assignedTo = null;
    } else if (assignedTo) {
      where.assignedTo = assignedTo;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const leads = await prisma.lead.findMany({
      where,
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // Track 6/10 (Phase 39): score har lead par compute kar ke attach hota hai (stored nahi).
    const scored = leads.map((lead) => {
      const { score, grade } = computeLeadScore(lead);
      return { ...lead, score, grade };
    });
    if (sort === 'score') scored.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
    res.json({ leads: scored });
  } catch (e) { next(e); }
});

// Track 6/10 (Phase 39): Lead score breakdown (explainable) — GET /api/leads/:id/score
router.get('/:id/score', async (req, res, next) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { assignee: { select: { id: true, name: true } } },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    // Tour/Quotation/LeadActivity relations schema merge ke baad yahan
    // include ho sakte hain — computeLeadScore unhe auto pick karega.
    res.json({ leadId: lead.id, ...computeLeadScore(lead) });
  } catch (e) { next(e); }
});

// Sales funnel: stage counts + avg pipeline age + conversion rate
router.get('/funnel', async (req, res, next) => {
  try {
    const filter = tenantFilter(req);
    const grouped = await prisma.lead.groupBy({
      by: ['stage'],
      where: filter,
      _count: { _all: true },
    });
    const counts = {};
    for (const s of STAGES) counts[s] = 0;
    for (const g of grouped) counts[g.stage] = (counts[g.stage] || 0) + g._count._all;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const open = ['new', 'contacted', 'visit'].reduce((a, s) => a + (counts[s] || 0), 0);
    const won = counts.booked || 0;
    const lost = counts.lost || 0;
    const decided = won + lost;
    // Avg days from creation to now per open stage, and approx days-to-close for booked
    const now = Date.now();
    const avgDays = {};
    for (const s of ['new', 'contacted', 'visit']) {
      const agg = await prisma.lead.aggregate({ where: { ...filter, stage: s }, _count: { _all: true } });
      if (!agg._count._all) { avgDays[s] = null; continue; }
      const sample = await prisma.lead.findMany({ where: { ...filter, stage: s }, select: { createdAt: true } });
      avgDays[s] = Math.round(sample.reduce((a, l) => a + (now - new Date(l.createdAt).getTime()) / 86400000, 0) / sample.length * 10) / 10;
    }
    const closed = await prisma.lead.findMany({ where: { ...filter, stage: 'booked' }, select: { createdAt: true, updatedAt: true } });
    avgDays.booked = closed.length
      ? Math.round(closed.reduce((a, l) => a + (new Date(l.updatedAt).getTime() - new Date(l.createdAt).getTime()) / 86400000, 0) / closed.length * 10) / 10
      : null;
    res.json({
      counts,
      total,
      open,
      won,
      lost,
      conversionRate: total ? Math.round((won / total) * 1000) / 10 : 0,
      winRate: decided ? Math.round((won / decided) * 1000) / 10 : 0,
      avgDays,
    });
  } catch (e) { next(e); }
});

// Sales leaderboard: booked leads per assignee, last 30 days
router.get('/leaderboard', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 86400000);
    const filter = { ...tenantFilter(req), stage: 'booked', updatedAt: { gte: since } };
    const grouped = await prisma.lead.groupBy({
      by: ['assignedTo'],
      where: filter,
      _count: { _all: true },
    });
    const userIds = grouped.map((g) => g.assignedTo).filter(Boolean);
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const board = grouped
      .map((g) => ({ userId: g.assignedTo, name: g.assignedTo ? (names[g.assignedTo] || '—') : 'Unassigned', won: g._count._all }))
      .sort((a, b) => b.won - a.won);
    res.json({ leaderboard: board, periodDays: 30 });
  } catch (e) { next(e); }
});

// Create lead
router.post('/', salesWrite, validateBody(leadSchema), async (req, res, next) => {
  try {
    const lead = await prisma.lead.create({
      data: { ...normalizeLeadInput(req.body), tenantId: req.user.tenantId },
    });
    await audit(req, 'lead.create', lead.id, { name: lead.name, stage: lead.stage });
    res.status(201).json({ lead });
  } catch (e) { next(e); }
});

// Update lead (incl. stage move)
router.patch('/:id', salesWrite, validateBody(leadSchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });
    if (req.body.stage === 'lost' && existing.stage !== 'lost')
      return res.status(400).json({ error: 'lostReason is required — use POST /:id/lost' });
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: normalizeLeadInput(req.body) });
    await audit(req, 'lead.update', lead.id, { name: lead.name, stage: lead.stage });
    res.json({ lead });
  } catch (e) { next(e); }
});

// Convert lead -> Member (+ optional contract draft) — Phase 39 Track 7.
// Body: { planId?, unitId?, startDate?, endDate?, rentAmount? }
// Everything happens inside one transaction: no half conversion.
const convertSchema = z.object({
  planId: z.string().min(1).optional().nullable(),
  unitId: z.string().min(1).optional().nullable(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional().nullable(),
  rentAmount: z.number().nonnegative().optional().nullable(),
});
router.post('/:id/convert', salesWrite, validateBody(convertSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...tf },
      include: { assignee: { select: { id: true, name: true } } },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.convertedMemberId) return res.status(400).json({ error: 'Lead already converted' });
    if (!lead.phone) return res.status(400).json({ error: 'Phone is required to convert a lead' });

    // Duplicate check: phone or email already a member in this tenant.
    const dup = await prisma.member.findFirst({
      where: {
        ...tf,
        OR: [
          { phone: lead.phone },
          ...(lead.email ? [{ email: lead.email }] : []),
        ],
      },
      select: { id: true, name: true, phone: true, email: true },
    });
    if (dup) return res.status(409).json({ error: `Already a member (${dup.name})` });

    // Phase 22: plan member limit (same as POST /api/members).
    const limit = await checkLimit(req.user.tenantId, 'members');
    if (!limit.allowed) {
      return res.status(402).json({ error: `Member limit reached (${limit.used}/${limit.limit}). Upgrade your plan to add more members.` });
    }

    const { planId, unitId, startDate, endDate, rentAmount } = req.body;

    let plan = null;
    if (planId) {
      plan = await prisma.membershipPlan.findFirst({ where: { id: planId, ...tf } });
      if (!plan) return res.status(400).json({ error: 'Membership plan not found' });
    }

    let unit = null;
    if (unitId) {
      unit = await prisma.unit.findFirst({ where: { id: unitId, ...tf } });
      if (!unit) return res.status(400).json({ error: 'Unit not found' });
      if (unit.type === 'meeting_room') {
        return res.status(400).json({ error: 'Meeting rooms cannot be contracted — use bookings' });
      }
      const clash = await prisma.contract.findFirst({ where: { unitId, status: 'active', ...tf } });
      if (clash) return res.status(409).json({ error: 'Unit already has an active contract' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.member.create({
        data: {
          ...tf,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          companyName: lead.company,
          // Note: Member has no planId field — the plan is linked via the Contract below.
          notes: lead.notes ? `Converted from lead. ${lead.notes}` : 'Converted from lead',
          status: 'active',
        },
      });
      let contract = null;
      if (unit) {
        contract = await tx.contract.create({
          data: {
            ...tf,
            memberId: member.id,
            unitId: unit.id,
            planId: plan ? plan.id : null,
            startDate: startDate || new Date(),
            endDate: endDate || null,
            // ContractStatus has no 'draft' enum value (migration out of scope),
            // so the contract is created active exactly like the normal contract flow.
            rentAmount: rentAmount != null ? rentAmount : (unit.monthlyPrice != null ? Number(unit.monthlyPrice) : 0),
          },
        });
        await tx.unit.update({ where: { id: unit.id }, data: { status: 'occupied' } });
      }
      const updatedLead = await tx.lead.update({
        where: { id: lead.id },
        data: { convertedMemberId: member.id, stage: 'won' },
      });
      return { member, contract, updatedLead };
    });

    const { member, contract, updatedLead } = result;

    // Sales credit: assigned salesperson keeps credit for the conversion (Track 9 dashboard reads this).
    const salesCredit = {
      assignedTo: lead.assignedTo || null,
      assignedName: lead.assignee ? lead.assignee.name : null,
      convertedBy: req.user.sub,
    };

    await audit(req, 'lead.convert', lead.id, {
      memberId: member.id,
      contractId: contract ? contract.id : null,
      salesCredit,
    });

    // Post-transaction side effects (never fail the conversion).
    emitWebhook(req.user.tenantId, 'member.created', { id: member.id, name: member.name, email: member.email });
    if (contract) emitWebhook(req.user.tenantId, 'contract.created', { id: contract.id, memberId: contract.memberId, unitId: contract.unitId });
    if (lead.email) {
      notify(req.user.tenantId, lead.email, 'memberWelcome', {
        memberName: lead.name,
        planName: plan ? plan.name : null,
        unitCode: unit ? unit.code : null,
      }).catch(() => {});
    }

    res.status(201).json({ lead: updatedLead, member, contract, salesCredit });
  } catch (e) { next(e); }
});

// Delete lead
router.delete('/:id', salesWrite, async (req, res, next) => {
  try {
    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });
    await prisma.lead.delete({ where: { id: req.params.id } });
    await audit(req, 'lead.delete', req.params.id, { name: existing.name });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Phase 39 Track 1: stage change + activity timeline
// ---------------------------------------------------------------------------

const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  body: z.string().min(1).max(5000),
});

function activityEnabled(res) {
  if (!prisma.leadActivity) {
    res.status(503).json({ error: 'Lead activity tracking not enabled yet (migration pending)' });
    return false;
  }
  return true;
}

// Change stage (logs a stage_change activity automatically)
// NOTE (Track 8): moving to stage 'lost' requires lostReason — use POST /:id/lost instead.
router.patch('/:id/stage', salesWrite, validateBody(z.object({ stage: z.enum(STAGES) })), async (req, res, next) => {
  try {
    if (!activityEnabled(res)) return;
    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });
    const { stage } = req.body;
    if (existing.stage === stage) return res.json({ lead: existing });
    if (stage === 'lost') return res.status(400).json({ error: 'lostReason is required — use POST /:id/lost' });
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: { stage } });
    await prisma.leadActivity.create({
      data: {
        tenantId: req.user.tenantId,
        leadId: lead.id,
        type: 'stage_change',
        body: `Stage changed from ${existing.stage} to ${stage}`,
        createdBy: req.user.sub,
      },
    });
    await audit(req, 'lead.stage', lead.id, { from: existing.stage, to: stage });
    try { const { suggestFollowupForStage } = require('../lib/leadFollowupDigest');
      await suggestFollowupForStage(req.user.tenantId, lead, existing.stage, stage, req.user.sub);
    } catch {}
    res.json({ lead });
  } catch (e) { next(e); }
});

// Log an activity (call/email/tour/note) on a lead; touches lastContactAt
router.post('/:id/activity', salesWrite, validateBody(activitySchema), async (req, res, next) => {
  try {
    if (!activityEnabled(res)) return;
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const { type, body } = req.body;
    const activity = await prisma.leadActivity.create({
      data: {
        tenantId: req.user.tenantId,
        leadId: lead.id,
        type,
        body,
        createdBy: req.user.sub,
      },
      include: { creator: { select: { id: true, name: true } } },
    });
    if (['call', 'email', 'tour'].includes(type)) {
      await prisma.lead.update({ where: { id: lead.id }, data: { lastContactAt: new Date() } });
    }
    await audit(req, 'lead.activity', lead.id, { type });
    res.status(201).json({ activity });
  } catch (e) { next(e); }
});

// Activity timeline for a lead
router.get('/:id/activities', async (req, res, next) => {
  try {
    if (!activityEnabled(res)) return;
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const activities = await prisma.leadActivity.findMany({
      where: { leadId: lead.id, ...tenantFilter(req) },
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ activities });
  } catch (e) { next(e); }
});

module.exports = router;
