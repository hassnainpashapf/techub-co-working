// Phase 39 Track 5: Follow-up Reminders for Leads.
// Full-cycle: per-lead follow-ups (call/email/whatsapp/tour) with due dates,
// "My follow-ups" (aaj ke due), done/skip actions, audit-logged completions.
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

const SALES_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const salesWrite = requireRole(...SALES_ROLES);

const TYPES = ['call', 'email', 'whatsapp', 'tour'];
const STATUSES = ['pending', 'done', 'skipped'];

const followupSchema = z.object({
  leadId: z.string().min(1),
  dueAt: z.string().min(1), // ISO datetime
  type: z.enum(TYPES),
  note: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
});

const updateSchema = z.object({
  dueAt: z.string().min(1).optional(),
  type: z.enum(TYPES).optional(),
  note: z.string().optional().nullable(),
  status: z.enum(STATUSES).optional(),
  assignedTo: z.string().optional().nullable(),
});

function audit(req, action, entityId, newValue) {
  return writeAudit({
    tenantId: req.user.tenantId,
    actorId: req.user.sub,
    action,
    entity: 'LeadFollowup',
    entityId,
    newValue: newValue || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch(() => {});
}

const notEnabled = (req, res) =>
  res.status(503).json({ error: 'Follow-ups not enabled yet (migration pending)' });

const guard = (req, res, next) => {
  if (!prisma.leadFollowup) return notEnabled(req, res);
  return next();
};

const select = {
  id: true, leadId: true, dueAt: true, type: true, note: true, status: true,
  assignedTo: true, createdAt: true,
  lead: { select: { id: true, name: true, phone: true, email: true, stage: true } },
  assignee: { select: { id: true, name: true } },
};

// List follow-ups (?status=, ?leadId=, ?mine=1, ?overdue=1)
router.get('/', guard, async (req, res, next) => {
  try {
    const { status, leadId, mine, overdue } = req.query;
    const where = { ...tenantFilter(req) };
    if (status && STATUSES.includes(status)) where.status = status;
    if (leadId) where.leadId = String(leadId);
    if (mine === '1') where.assignedTo = req.user.sub;
    if (overdue === '1') where.dueAt = { lt: new Date() };
    const rows = await prisma.leadFollowup.findMany({
      where, select, orderBy: [{ dueAt: 'asc' }],
    });
    res.json({ followups: rows });
  } catch (e) { next(e); }
});

// GET /due — aaj ke due + overdue follow-ups for the current user.
router.get('/due', guard, async (req, res, next) => {
  try {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const rows = await prisma.leadFollowup.findMany({
      where: {
        ...tenantFilter(req),
        assignedTo: req.user.sub,
        status: 'pending',
        dueAt: { lte: endOfToday },
      },
      select, orderBy: [{ dueAt: 'asc' }],
    });
    res.json({
      followups: rows.map((r) => ({ ...r, overdue: new Date(r.dueAt) < now })),
      dueCount: rows.length,
      overdueCount: rows.filter((r) => new Date(r.dueAt) < now).length,
    });
  } catch (e) { next(e); }
});

// Create a follow-up (verifies the lead belongs to this tenant).
router.post('/', salesWrite, guard, validateBody(followupSchema), async (req, res, next) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.body.leadId, ...tenantFilter(req) },
      select: { id: true, name: true, stage: true },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const f = await prisma.leadFollowup.create({
      data: {
        tenantId: req.user.tenantId,
        leadId: lead.id,
        dueAt: new Date(req.body.dueAt),
        type: req.body.type,
        note: req.body.note || null,
        assignedTo: req.body.assignedTo || req.user.sub,
      },
      select,
    });
    await audit(req, 'lead_followup.create', f.id, {
      leadId: lead.id, leadName: lead.name, type: f.type, dueAt: f.dueAt,
    });
    res.status(201).json({ followup: f });
  } catch (e) { next(e); }
});

// Update (reschedule, reassign, note change…)
router.patch('/:id', salesWrite, guard, validateBody(updateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.leadFollowup.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Follow-up not found' });
    const data = { ...req.body };
    if (data.dueAt) data.dueAt = new Date(data.dueAt);
    const f = await prisma.leadFollowup.update({
      where: { id: req.params.id }, data, select,
    });
    await audit(req, 'lead_followup.update', f.id, { status: f.status });
    res.json({ followup: f });
  } catch (e) { next(e); }
});

// POST /:id/done — mark complete + auto activity log (audit on the lead).
router.post('/:id/done', salesWrite, guard, async (req, res, next) => {
  try {
    const existing = await prisma.leadFollowup.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { lead: { select: { id: true, name: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Follow-up not found' });
    const f = await prisma.leadFollowup.update({
      where: { id: req.params.id }, data: { status: 'done' }, select,
    });
    // Auto activity log: audit entry on the follow-up + note on the lead.
    await audit(req, 'lead_followup.done', f.id, {
      leadId: existing.lead.id, leadName: existing.lead.name,
      type: existing.type, note: existing.note,
      completedBy: req.user.sub, completedAt: new Date().toISOString(),
    });
    try {
      const { writeAudit: wa } = require('../middleware/audit');
      await wa({
        tenantId: req.user.tenantId, actorId: req.user.sub,
        action: 'lead.followup_done', entity: 'Lead', entityId: existing.lead.id,
        newValue: { type: existing.type, note: existing.note, by: req.user.sub },
        ip: req.ip, userAgent: req.headers['user-agent'],
      }).catch(() => {});
    } catch {}
    res.json({ followup: f });
  } catch (e) { next(e); }
});

// POST /:id/skip
router.post('/:id/skip', salesWrite, guard, async (req, res, next) => {
  try {
    const existing = await prisma.leadFollowup.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Follow-up not found' });
    const f = await prisma.leadFollowup.update({
      where: { id: req.params.id }, data: { status: 'skipped' }, select,
    });
    await audit(req, 'lead_followup.skip', f.id, { reason: req.body?.reason || null });
    res.json({ followup: f });
  } catch (e) { next(e); }
});

// Delete
router.delete('/:id', salesWrite, guard, async (req, res, next) => {
  try {
    const existing = await prisma.leadFollowup.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Follow-up not found' });
    await prisma.leadFollowup.delete({ where: { id: req.params.id } });
    await audit(req, 'lead_followup.delete', req.params.id, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
