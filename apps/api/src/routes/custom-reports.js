// Phase 52 Track 1/10: Custom Report Builder — API.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/custom-reports', require('./routes/custom-reports'));
// SIDEBAR (coordinator Sidebar.js me ADD karein — naya "Reports" section ya existing me):
//   { label: 'Report Builder', path: '/reports/builder', roles: ['ceo','admin','super_admin','manager'] }
// NOTE: CustomReport model reports-builder.prisma fragment se aata hai —
// migration pending ho to endpoints 503 dete hain (koi crash nahi).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { runReport, listEntities, ENTITY_REGISTRY, FILTER_OPS, MAX_ROWS } = require('../lib/reportEngine');
const { canViewReport, canEditReport, filterReports, validateSharing } = require('../lib/reportAccess');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

function modelReady() {
  return typeof prisma.customReport?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'reports migration pending' });
  next();
}
router.use(guard);

const columnSchema = z.object({ field: z.string().min(1).max(80), label: z.string().max(80).optional() });
const filterSchema = z.object({
  field: z.string().min(1).max(80),
  op: z.enum(FILTER_OPS),
  value: z.any(),
});
const sortSchema = z.object({ field: z.string().min(1).max(80), dir: z.enum(['asc', 'desc']).default('asc') });

const defSchema = z.object({
  entity: z.string().refine((e) => !!ENTITY_REGISTRY[e], { message: 'Unknown entity' }),
  columns: z.array(columnSchema).min(1).max(40),
  filters: z.array(filterSchema).max(20).optional().default([]),
  sorts: z.array(sortSchema).max(5).optional().default([]),
  groupBy: z.string().max(80).optional().nullable(),
});

const reportSchema = z.object({
  name: z.string().min(2).max(100),
  entity: z.string().refine((e) => !!ENTITY_REGISTRY[e], { message: 'Unknown entity' }),
  columns: z.array(columnSchema).min(1).max(40),
  filters: z.array(filterSchema).max(20).optional().default([]),
  sorts: z.array(sortSchema).max(5).optional().default([]),
  groupBy: z.string().max(80).optional().nullable(),
  isPublic: z.boolean().default(false).optional(),
  sharedWithRoles: z.array(z.string().max(40)).optional().nullable(),
});

// sharing validate helper
function sharingValue(input) {
  if (input === undefined) return {};
  const v = validateSharing(input);
  if (!v.ok) { const e = new Error(v.error); e.status = 422; throw e; }
  return { sharedWithRoles: v.value };
}

// GET /api/custom-reports/meta — entities + allowed fields (builder UI ke liye)
router.get('/meta', requireRole(...STAFF), async (req, res, next) => {
  try {
    res.json({ entities: listEntities(), filterOps: FILTER_OPS, maxRows: MAX_ROWS });
  } catch (err) { next(err); }
});

// GET /api/custom-reports/meta/:entity — single entity field metadata (builder column picker)
router.get('/meta/:entity', requireRole(...STAFF), async (req, res, next) => {
  try {
    const key = String(req.params.entity || '').toLowerCase();
    if (!ENTITY_REGISTRY[key]) return res.status(404).json({ error: 'Unknown entity' });
    const entry = listEntities().find((e) => e.key === key);
    res.json({ entity: entry, filterOps: FILTER_OPS, maxRows: MAX_ROWS });
  } catch (err) { next(err); }
});

// GET /api/custom-reports — list (reportAccess filter ke baad)
router.get('/', requireRole(...STAFF), async (req, res, next) => {
  try {
    const reports = await prisma.customReport.findMany({
      where: { ...tenantFilter(req) },
      orderBy: [{ updatedAt: 'desc' }],
      select: { id: true, name: true, entity: true, isPublic: true, sharedWithRoles: true, ownerId: true, createdAt: true, updatedAt: true },
    });
    res.json({ reports: filterReports(req.user, reports) });
  } catch (err) { next(err); }
});

// GET /api/custom-reports/:id (view guard)
router.get('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const report = await prisma.customReport.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (!canViewReport(req.user, report)) return res.status(403).json({ error: 'Access denied' });
    res.json({ report });
  } catch (err) { next(err); }
});

// POST /api/custom-reports — create
router.post('/', requireRole(...STAFF), async (req, res, next) => {
  try {
    const body = reportSchema.parse(req.body || {});
    // def engine se bhi validate (allowlist)
    const { validateDef } = require('../lib/reportEngine');
    validateDef(body);
    const report = await prisma.customReport.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name,
        entity: body.entity,
        columns: body.columns,
        filters: body.filters,
        sorts: body.sorts,
        groupBy: body.groupBy || null,
        isPublic: !!body.isPublic,
        ownerId: req.user.id || null,
        ...sharingValue(body.sharedWithRoles),
      },
    });
    await writeAudit({ tenantId: req.user.tenantId, actorId: req.user.id, action: 'custom_report.create', entity: 'CustomReport', entityId: report.id, newValue: { name: report.name, entity: report.entity } });
    res.status(201).json({ report });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/custom-reports/:id — update
router.patch('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const body = reportSchema.partial().parse(req.body || {});
    const existing = await prisma.customReport.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    if (!canEditReport(req.user, existing)) return res.status(403).json({ error: 'Sirf owner ya admin edit kar sakta hai' });
    const merged = { ...existing, ...body };
    const { validateDef } = require('../lib/reportEngine');
    validateDef(merged);
    const report = await prisma.customReport.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.entity !== undefined ? { entity: body.entity } : {}),
        ...(body.columns !== undefined ? { columns: body.columns } : {}),
        ...(body.filters !== undefined ? { filters: body.filters } : {}),
        ...(body.sorts !== undefined ? { sorts: body.sorts } : {}),
        ...(body.groupBy !== undefined ? { groupBy: body.groupBy || null } : {}),
        ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
        ...(body.sharedWithRoles !== undefined ? sharingValue(body.sharedWithRoles) : {}),
      },
    });
    await writeAudit({ tenantId: req.user.tenantId, actorId: req.user.id, action: 'custom_report.update', entity: 'CustomReport', entityId: report.id, newValue: { name: report.name } });
    res.json({ report });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/custom-reports/:id (edit guard)
router.delete('/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const existing = await prisma.customReport.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    if (!canEditReport(req.user, existing)) return res.status(403).json({ error: 'Sirf owner ya admin edit kar sakta hai' });
    await prisma.customReport.delete({ where: { id: existing.id } });
    await writeAudit({ tenantId: req.user.tenantId, actorId: req.user.id, action: 'custom_report.delete', entity: 'CustomReport', entityId: existing.id, oldValue: { name: existing.name } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/custom-reports/adhoc/run — unsaved def ka preview (builder "new" mode).
// NOTE: /:id/run se PEHLE register hai taake 'adhoc' id ki tarah na pakda jaye.
router.post('/adhoc/run', requireRole(...STAFF), async (req, res, next) => {
  try {
    const def = defSchema.parse(req.body && req.body.def ? req.body.def : req.body);
    const result = await runReport(req.user.tenantId, def, {
      page: req.query.page || req.body?.page,
      limit: req.query.limit || req.body?.limit,
    });
    res.json(result);
  } catch (err) {
    if (err.status === 422 || err.status === 503) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/custom-reports/:id/run — saved report chalao (view guard); body.def se adhoc def bhi chal sakta hai
router.post('/:id/run', requireRole(...STAFF), async (req, res, next) => {
  try {
    let def;
    if (req.body && req.body.def) {
      def = defSchema.parse(req.body.def);
    } else {
      const report = await prisma.customReport.findFirst({
        where: { id: req.params.id, ...tenantFilter(req) },
      });
      if (!report) return res.status(404).json({ error: 'Report not found' });
      if (!canViewReport(req.user, report)) return res.status(403).json({ error: 'Access denied' });
      def = {
        entity: report.entity,
        columns: report.columns,
        filters: report.filters || [],
        sorts: report.sorts || [],
        groupBy: report.groupBy,
      };
    }
    const result = await runReport(req.user.tenantId, def, {
      page: req.query.page || req.body?.page,
      limit: req.query.limit || req.body?.limit,
    });
    await writeAudit({ tenantId: req.user.tenantId, actorId: req.user.id, action: 'custom-report.run', entity: 'CustomReport', entityId: req.params.id, newValue: { entity: def.entity, total: result.total } }).catch(() => {});
    res.json(result);
  } catch (err) {
    if (err.status === 422 || err.status === 503) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
