// Phase 39 Track 3: Tour Scheduling — staff books site tours for leads,
// with completion/cancel/no-show actions and 24h + 2h reminders (job).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];
const OUTCOMES = ['interested', 'not_interested', 'undecided'];
const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'sales', 'receptionist'];
const staffOnly = requireRole(...STAFF_ROLES);

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'Tour',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

// LeadActivity is added by Phase 39 Track 1 — log activity when available,
// skip silently before the merge.
async function logLeadActivity(tenantId, leadId, type, body, actorId) {
  try {
    if (!prisma.leadActivity) return;
    await prisma.leadActivity.create({
      data: { tenantId, leadId, type, body, createdBy: actorId || null },
    });
  } catch {
    /* non-fatal */
  }
}

// Progressive stage nudge: scheduling a tour moves an early lead to "visit".
async function nudgeLeadToVisit(req, lead) {
  if (!lead || !['new', 'contacted'].includes(lead.stage)) return;
  await prisma.lead.update({ where: { id: lead.id }, data: { stage: 'visit' } });
  await logLeadActivity(req.user.tenantId, lead.id, 'stage_change', 'Stage → visit (tour scheduled)', req.user.sub);
}

// ---------------------------------------------------------------------------
router.use(authenticate, requireTenantUser);

// GET / — list (filters: status, upcoming, leadId, search via lead name)
router.get('/', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.tour) return res.status(503).json({ error: 'Tours not enabled yet' });
    const { status, leadId, upcoming } = req.query;
    const where = { ...tenantFilter(req) };
    if (status && STATUSES.includes(status)) where.status = status;
    if (leadId) where.leadId = String(leadId);
    if (upcoming === '1') where.scheduledAt = { gte: new Date() };
    const tours = await prisma.tour.findMany({
      where,
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true, stage: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 200,
    });
    res.json({ tours });
  } catch (e) { next(e); }
});

// GET /:id
router.get('/:id', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.tour) return res.status(503).json({ error: 'Tours not enabled yet' });
    const tour = await prisma.tour.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: {
        lead: true,
        assignee: { select: { id: true, name: true } },
      },
    });
    if (!tour) return res.status(404).json({ error: 'Tour not found' });
    res.json({ tour });
  } catch (e) { next(e); }
});

const tourSchema = z.object({
  leadId: z.string().min(1),
  scheduledAt: z.string().min(1), // ISO datetime
  durationMin: z.number().int().min(15).max(240).optional(),
  assignedTo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// POST / — schedule a tour
router.post('/', staffOnly, validateBody(tourSchema), async (req, res, next) => {
  try {
    if (!prisma.tour) return res.status(503).json({ error: 'Tours not enabled yet' });
    const { leadId, scheduledAt, durationMin, assignedTo, notes } = req.body;
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, ...tenantFilter(req) },
      select: { id: true, stage: true, name: true },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid scheduledAt' });
    if (when < new Date()) return res.status(400).json({ error: 'Tour must be scheduled in the future' });

    const tour = await prisma.tour.create({
      data: {
        tenantId: req.user.tenantId,
        leadId,
        scheduledAt: when,
        durationMin: durationMin || 30,
        assignedTo: assignedTo || null,
        notes: notes || null,
      },
      include: { lead: { select: { id: true, name: true } } },
    });
    await nudgeLeadToVisit(req, lead);
    await logLeadActivity(req.user.tenantId, leadId, 'tour', `Tour scheduled for ${when.toLocaleString()}`, req.user.sub);
    await audit(req, 'tour.schedule', tour.id, { leadId, scheduledAt: when });
    res.status(201).json({ tour });
  } catch (e) { next(e); }
});

const updateSchema = z.object({
  scheduledAt: z.string().optional(),
  durationMin: z.number().int().min(15).max(240).optional(),
  assignedTo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// PATCH /:id — reschedule / edit (scheduled tours only)
router.patch('/:id', staffOnly, validateBody(updateSchema), async (req, res, next) => {
  try {
    if (!prisma.tour) return res.status(503).json({ error: 'Tours not enabled yet' });
    const existing = await prisma.tour.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Tour not found' });
    if (existing.status !== 'scheduled') return res.status(409).json({ error: 'Only scheduled tours can be edited' });
    const data = {};
    if (req.body.scheduledAt !== undefined) {
      const when = new Date(req.body.scheduledAt);
      if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid scheduledAt' });
      data.scheduledAt = when;
      // rescheduling resets reminders so the lead still gets notified
      data.reminder24hSentAt = null;
      data.reminder2hSentAt = null;
    }
    if (req.body.durationMin !== undefined) data.durationMin = req.body.durationMin;
    if (req.body.assignedTo !== undefined) data.assignedTo = req.body.assignedTo || null;
    if (req.body.notes !== undefined) data.notes = req.body.notes || null;
    const tour = await prisma.tour.update({ where: { id: existing.id }, data });
    await audit(req, 'tour.update', tour.id, data);
    res.json({ tour });
  } catch (e) { next(e); }
});

// POST /:id/complete {outcome, notes}
router.post('/:id/complete', staffOnly, validateBody(z.object({
  outcome: z.enum(OUTCOMES),
  notes: z.string().optional().nullable(),
})), async (req, res, next) => {
  try {
    if (!prisma.tour) return res.status(503).json({ error: 'Tours not enabled yet' });
    const existing = await prisma.tour.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { lead: { select: { id: true, stage: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Tour not found' });
    if (existing.status !== 'scheduled') return res.status(409).json({ error: 'Only scheduled tours can be completed' });
    const { outcome, notes } = req.body;
    const tour = await prisma.tour.update({
      where: { id: existing.id },
      data: {
        status: 'completed',
        outcome,
        notes: notes !== undefined && notes !== null ? notes : existing.notes,
      },
    });
    await logLeadActivity(req.user.tenantId, existing.leadId, 'tour', `Tour completed — outcome: ${outcome}${notes ? ` — ${notes}` : ''}`, req.user.sub);
    await audit(req, 'tour.complete', tour.id, { outcome });
    res.json({ tour });
  } catch (e) { next(e); }
});

// POST /:id/cancel
router.post('/:id/cancel', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.tour) return res.status(503).json({ error: 'Tours not enabled yet' });
    const existing = await prisma.tour.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Tour not found' });
    if (existing.status !== 'scheduled') return res.status(409).json({ error: 'Only scheduled tours can be cancelled' });
    const tour = await prisma.tour.update({ where: { id: existing.id }, data: { status: 'cancelled' } });
    await logLeadActivity(req.user.tenantId, existing.leadId, 'tour', 'Tour cancelled', req.user.sub);
    await audit(req, 'tour.cancel', tour.id, null);
    res.json({ tour });
  } catch (e) { next(e); }
});

// POST /:id/no-show
router.post('/:id/no-show', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.tour) return res.status(503).json({ error: 'Tours not enabled yet' });
    const existing = await prisma.tour.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Tour not found' });
    if (existing.status !== 'scheduled') return res.status(409).json({ error: 'Only scheduled tours can be marked no-show' });
    const tour = await prisma.tour.update({ where: { id: existing.id }, data: { status: 'no_show' } });
    await logLeadActivity(req.user.tenantId, existing.leadId, 'tour', 'Tour marked as no-show', req.user.sub);
    await audit(req, 'tour.no_show', tour.id, null);
    res.json({ tour });
  } catch (e) { next(e); }
});

// DELETE /:id
router.delete('/:id', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.tour) return res.status(503).json({ error: 'Tours not enabled yet' });
    const existing = await prisma.tour.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Tour not found' });
    await prisma.tour.delete({ where: { id: existing.id } });
    await audit(req, 'tour.delete', existing.id, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
