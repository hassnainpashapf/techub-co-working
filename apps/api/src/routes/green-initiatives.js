// Phase 51 Track 9/10: Green Initiatives.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/green-initiatives', require('./routes/green-initiatives'));
// NOTE: GreenInitiative model track ke green-initiatives.prisma fragment se aata hai —
// migration pending ho to endpoints 503 dete hain (koi crash nahi).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

function modelReady() {
  return typeof prisma.greenInitiative?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'green-initiatives migration pending' });
  next();
}
router.use(guard);

function auditReq(req, entry) {
  try {
    const { tenantId } = tenantFilter(req);
    writeAudit({
      tenantId,
      actorId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      ...entry,
    });
  } catch { /* audit kabhi request nahi girayega */ }
}

const ROLES = ['ceo', 'admin', 'super_admin', 'manager'];

const CATEGORIES = ['energy', 'water', 'waste', 'awareness'];
const STATUSES = ['planned', 'active', 'completed'];
const NEXT_STATUS = { planned: ['active'], active: ['completed', 'planned'], completed: ['active'] };

const initiativeSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional().nullable(),
  category: z.enum(CATEGORIES).default('energy'),
  targetValue: z.number().nonnegative().optional().nullable(),
  currentValue: z.number().nonnegative().default(0).optional(),
  unit: z.string().max(20).optional().nullable(),
  startDate: z.string().datetime({ offset: true }).or(z.string().min(1)),
  endDate: z.string().datetime({ offset: true }).optional().nullable().or(z.literal('')),
  status: z.enum(STATUSES).default('planned').optional(),
});

function withProgress(row) {
  const target = row.targetValue;
  const progress = target && target > 0
    ? Math.min(100, Math.round((row.currentValue / target) * 100))
    : null;
  return { ...row, progress };
}

// GET /api/green-initiatives — list (+ summary)
router.get('/', requireRole(...ROLES), async (req, res, next) => {
  try {
    const { category, status } = req.query || {};
    const where = { ...tenantFilter(req) };
    if (category && CATEGORIES.includes(String(category))) where.category = String(category);
    if (status && STATUSES.includes(String(status))) where.status = String(status);
    const initiatives = await prisma.greenInitiative.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });
    const withP = initiatives.map(withProgress);
    const summary = {
      total: withP.length,
      planned: withP.filter((i) => i.status === 'planned').length,
      active: withP.filter((i) => i.status === 'active').length,
      completed: withP.filter((i) => i.status === 'completed').length,
      avgProgress: withP.filter((i) => i.progress !== null).length
        ? Math.round(withP.filter((i) => i.progress !== null).reduce((s, i) => s + i.progress, 0)
          / withP.filter((i) => i.progress !== null).length)
        : null,
    };
    res.json({ initiatives: withP, summary });
  } catch (err) { next(err); }
});

// GET /api/green-initiatives/:id
router.get('/:id', requireRole(...ROLES), async (req, res, next) => {
  try {
    const initiative = await prisma.greenInitiative.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!initiative) return res.status(404).json({ error: 'Initiative not found' });
    res.json({ initiative: withProgress(initiative) });
  } catch (err) { next(err); }
});

// POST /api/green-initiatives — create
router.post('/', requireRole(...ROLES), async (req, res, next) => {
  try {
    const data = initiativeSchema.parse(req.body || {});
    const tf = tenantFilter(req);
    const initiative = await prisma.greenInitiative.create({
      data: {
        ...tf,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        category: data.category,
        targetValue: data.targetValue ?? null,
        currentValue: data.currentValue ?? 0,
        unit: data.unit?.trim() || null,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        status: data.status || 'planned',
      },
    });
    auditReq(req, { action: 'green-initiative.create', entity: 'GreenInitiative', entityId: initiative.id, newValue: { title: initiative.title } });
    res.status(201).json({ initiative: withProgress(initiative) });
  } catch (err) { next(err); }
});

// PATCH /api/green-initiatives/:id — edit
router.patch('/:id', requireRole(...ROLES), async (req, res, next) => {
  try {
    const data = initiativeSchema.partial().parse(req.body || {});
    const tf = tenantFilter(req);
    const existing = await prisma.greenInitiative.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Initiative not found' });
    const update = {};
    if (data.title !== undefined) update.title = data.title.trim();
    if (data.description !== undefined) update.description = data.description?.trim() || null;
    if (data.category !== undefined) update.category = data.category;
    if (data.targetValue !== undefined) update.targetValue = data.targetValue ?? null;
    if (data.currentValue !== undefined) update.currentValue = data.currentValue;
    if (data.unit !== undefined) update.unit = data.unit?.trim() || null;
    if (data.startDate !== undefined) update.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) update.endDate = data.endDate ? new Date(data.endDate) : null;
    const initiative = await prisma.greenInitiative.update({ where: { id: existing.id }, data: update });
    auditReq(req, { action: 'green-initiative.update', entity: 'GreenInitiative', entityId: initiative.id, newValue: update });
    res.json({ initiative: withProgress(initiative) });
  } catch (err) { next(err); }
});

// PATCH /api/green-initiatives/:id/progress — progress update (currentValue + optional status)
router.patch('/:id/progress', requireRole(...ROLES), async (req, res, next) => {
  try {
    const body = z.object({
      currentValue: z.number().nonnegative(),
      status: z.enum(STATUSES).optional(),
    }).parse(req.body || {});
    const tf = tenantFilter(req);
    const existing = await prisma.greenInitiative.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Initiative not found' });
    if (body.status && body.status !== existing.status && !NEXT_STATUS[existing.status].includes(body.status)) {
      return res.status(422).json({ error: `Status ${existing.status} se ${body.status} par nahi ja sakta` });
    }
    const initiative = await prisma.greenInitiative.update({
      where: { id: existing.id },
      data: { currentValue: body.currentValue, ...(body.status ? { status: body.status } : {}) },
    });
    auditReq(req, { action: 'green-initiative.progress', entity: 'GreenInitiative', entityId: initiative.id, newValue: { currentValue: initiative.currentValue, status: initiative.status } });
    res.json({ initiative: withProgress(initiative) });
  } catch (err) { next(err); }
});

// PATCH /api/green-initiatives/:id/status — status workflow
router.patch('/:id/status', requireRole(...ROLES), async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(STATUSES) }).parse(req.body || {});
    const tf = tenantFilter(req);
    const existing = await prisma.greenInitiative.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Initiative not found' });
    if (status !== existing.status && !NEXT_STATUS[existing.status].includes(status)) {
      return res.status(422).json({ error: `Status ${existing.status} se ${status} par nahi ja sakta` });
    }
    const initiative = await prisma.greenInitiative.update({ where: { id: existing.id }, data: { status } });
    auditReq(req, { action: 'green-initiative.status', entity: 'GreenInitiative', entityId: initiative.id, newValue: { status } });
    res.json({ initiative: withProgress(initiative) });
  } catch (err) { next(err); }
});

// DELETE /api/green-initiatives/:id
router.delete('/:id', requireRole(...ROLES), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.greenInitiative.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'Initiative not found' });
    await prisma.greenInitiative.delete({ where: { id: existing.id } });
    auditReq(req, { action: 'green-initiative.delete', entity: 'GreenInitiative', entityId: existing.id, newValue: { title: existing.title } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
