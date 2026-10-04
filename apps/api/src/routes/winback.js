// Phase 54 Track 8: Win-Back Campaigns.
// Mount (coordinator): app.use('/api/winback', require('./routes/winback'));
// Sidebar link nahi — Success section extend karein.

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { runWinback, findTargetMembers, hasModels } = require('../lib/winback');

const router = express.Router();
router.use(authenticate, requireTenantUser);
const STAFF = requireRole('ceo', 'admin', 'super_admin', 'manager');

// Model merge na hua ho to 503 (koi 500 nahi).
router.use((req, res, next) => {
  if (!hasModels()) return res.status(503).json({ error: 'Win-back schema not deployed yet' });
  next();
});

const filterSchema = z.object({
  inactiveDays: z.number().int().min(7).max(365).default(60),
  plans: z.array(z.string()).optional().nullable(),
}).passthrough();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  targetFilter: filterSchema.optional().default({}),
  offerText: z.string().max(2000).optional().nullable(),
  subject: z.string().max(200).optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  targetFilter: filterSchema.optional(),
  offerText: z.string().max(2000).optional().nullable(),
  subject: z.string().max(200).optional().nullable(),
  status: z.enum(['draft', 'active', 'done']).optional(),
});

// GET /api/winback — campaigns list
router.get('/', STAFF, async (req, res, next) => {
  try {
    const campaigns = await prisma.winbackCampaign.findMany({
      where: tenantFilter(req),
      orderBy: { createdAt: 'desc' },
    });
    res.json({ campaigns });
  } catch (e) { next(e); }
});

// POST /api/winback — nayi campaign
router.post('/', STAFF, async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body || {});
    const campaign = await prisma.winbackCampaign.create({
      data: {
        ...tenantFilter(req),
        name: body.name,
        targetFilter: body.targetFilter || {},
        offerText: body.offerText || null,
        subject: body.subject || null,
        createdBy: req.user.id,
      },
    });
    writeAudit({ tenantId: req.user.tenantId, actorId: req.user.id, action: 'winback.created', entity: 'WinbackCampaign', entityId: campaign.id, newValue: { name: body.name }, ip: req.ip });
    res.status(201).json({ campaign });
  } catch (e) { next(e); }
});

// GET /api/winback/:id — campaign + target preview + logs
router.get('/:id', STAFF, async (req, res, next) => {
  try {
    const campaign = await prisma.winbackCampaign.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { logs: { orderBy: { sentAt: 'desc' }, take: 50 } },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const preview = await findTargetMembers(req.user.tenantId, campaign.targetFilter || {});
    res.json({
      campaign,
      targetPreview: {
        count: preview.length,
        members: preview.slice(0, 20).map((m) => ({ id: m.id, name: m.name, email: m.email, plan: m.plan })),
      },
    });
  } catch (e) { next(e); }
});

// PATCH /api/winback/:id
router.patch('/:id', STAFF, async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body || {});
    const existing = await prisma.winbackCampaign.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Campaign not found' });
    const data = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.targetFilter !== undefined) data.targetFilter = body.targetFilter;
    if (body.offerText !== undefined) data.offerText = body.offerText;
    if (body.subject !== undefined) data.subject = body.subject;
    if (body.status !== undefined) data.status = body.status;
    const campaign = await prisma.winbackCampaign.update({ where: { id: existing.id }, data });
    writeAudit({ tenantId: req.user.tenantId, actorId: req.user.id, action: 'winback.updated', entity: 'WinbackCampaign', entityId: campaign.id, newValue: body, ip: req.ip });
    res.json({ campaign });
  } catch (e) { next(e); }
});

// DELETE /api/winback/:id — sirf draft
router.delete('/:id', STAFF, async (req, res, next) => {
  try {
    const existing = await prisma.winbackCampaign.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Campaign not found' });
    if (existing.status !== 'draft') return res.status(422).json({ error: 'Only draft campaigns can be deleted' });
    await prisma.winbackCampaign.delete({ where: { id: existing.id } });
    writeAudit({ tenantId: req.user.tenantId, actorId: req.user.id, action: 'winback.deleted', entity: 'WinbackCampaign', entityId: existing.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/winback/:id/run — campaign chalao (target members ko offer email)
router.post('/:id/run', STAFF, async (req, res, next) => {
  try {
    const existing = await prisma.winbackCampaign.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Campaign not found' });
    const result = await runWinback(existing.id, { tenantId: req.user.tenantId, byUserId: req.user.id });
    if (result.error === 'not_found') return res.status(404).json({ error: 'Campaign not found' });
    if (result.error === 'already_done') return res.status(422).json({ error: 'Campaign already marked done' });
    writeAudit({ tenantId: req.user.tenantId, actorId: req.user.id, action: 'winback.run', entity: 'WinbackCampaign', entityId: existing.id, newValue: result, ip: req.ip });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

module.exports = router;
