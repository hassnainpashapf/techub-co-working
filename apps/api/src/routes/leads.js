// Phase 29 Track 3: Leads CRM — kanban pipeline for prospective members.
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

const STAGES = ['new', 'contacted', 'visit', 'booked', 'lost'];
const SOURCES = ['walkin', 'website', 'referral', 'social', 'other'];

const leadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  source: z.enum(SOURCES).optional(),
  interest: z.string().optional().nullable(),
  budget: z.number().nonnegative().optional().nullable(),
  stage: z.enum(STAGES).optional(),
  notes: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
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

// List leads (?stage=, ?search=)
router.get('/', async (req, res, next) => {
  try {
    const { stage, search } = req.query;
    const where = { ...tenantFilter(req) };
    if (stage && STAGES.includes(stage)) where.stage = stage;
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
    res.json({ leads });
  } catch (e) { next(e); }
});

// Create lead
router.post('/', salesWrite, validateBody(leadSchema), async (req, res, next) => {
  try {
    const lead = await prisma.lead.create({
      data: { ...req.body, tenantId: req.user.tenantId },
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
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: req.body });
    await audit(req, 'lead.update', lead.id, { name: lead.name, stage: lead.stage });
    res.json({ lead });
  } catch (e) { next(e); }
});

// Convert lead -> Member
router.post('/:id/convert', salesWrite, async (req, res, next) => {
  try {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.convertedMemberId) return res.status(400).json({ error: 'Lead already converted' });
    if (!lead.phone) return res.status(400).json({ error: 'Phone is required to convert a lead' });
    const member = await prisma.member.create({
      data: {
        tenantId: req.user.tenantId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        companyName: lead.company,
        notes: lead.notes ? `Converted from lead. ${lead.notes}` : 'Converted from lead',
        status: 'active',
      },
    });
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { convertedMemberId: member.id, stage: 'booked' },
    });
    await audit(req, 'lead.convert', lead.id, { memberId: member.id });
    res.status(201).json({ lead: updated, member });
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

module.exports = router;
