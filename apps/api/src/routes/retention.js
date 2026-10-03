// Phase 50 Track 8/10: Data Retention & GDPR tools.
// Mount: app.use('/api/retention', require('./routes/retention'));  (server.js, coordinator)
// Roles: ceo / admin / super_admin. Sidebar link nahi — legal section extend hai.
//
// Integration notes (coordinator):
// 1. Legal page (track 10 dashboard) me "Data Retention" tab jorein:
//    - Policies: GET /api/retention/policies, POST /api/retention/policies, PATCH :id, DELETE :id
//    - Dry-run preview: POST /api/retention/run { dataType?, dryRun: true }  (default dry-run)
//    - Live run: POST /api/retention/run { dataType?, dryRun: false } — wazeh confirm ke sath
//    - History: GET /api/retention/runs (?dataType=, ?mode=)
// 2. Phase 32 GDPR link: purge se PEHLE user member ka data export kar sakta hai —
//    POST /api/data-export/member/:id/export (pehle se mounted). Retention run page par
//    "Pehle GDPR export download karein" ka link dikhayein.

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const {
  retentionEnabled, validateDays, runRetention, runAllPolicies, TARGETS,
} = require('../lib/retention');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin'];
const staffOnly = requireRole(...STAFF);

function guard503(req, res, next) {
  if (!retentionEnabled()) return res.status(503).json({ error: 'Retention schema pending migration' });
  next();
}
router.use(guard503);

const DATA_TYPES = Object.keys(TARGETS);

const policySchema = z.object({
  dataType: z.enum(DATA_TYPES),
  retainDays: z.number().int().min(7).max(3650),
  autoDelete: z.boolean().default(false),
});
const policyPatchSchema = z.object({
  retainDays: z.number().int().min(7).max(3650).optional(),
  autoDelete: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Policies CRUD
// ---------------------------------------------------------------------------
router.get('/policies', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const policies = await prisma.retentionPolicy.findMany({
      where: tf,
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { dataType: 'asc' },
    });
    res.json({ dataTypes: DATA_TYPES, policies });
  } catch (e) { next(e); }
});

router.post('/policies', staffOnly, validateBody(policySchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const days = validateDays(req.body.retainDays);
    const existing = await prisma.retentionPolicy.findFirst({
      where: { ...tf, dataType: req.body.dataType },
    });
    if (existing) return res.status(409).json({ error: 'Is dataType ki policy pehle se hai — edit karein' });
    const policy = await prisma.retentionPolicy.create({
      data: { ...tf, dataType: req.body.dataType, retainDays: days, autoDelete: !!req.body.autoDelete },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id, action: 'retention.policy_create',
      entity: 'RetentionPolicy', entityId: policy.id,
      newValue: { dataType: policy.dataType, retainDays: policy.retainDays, autoDelete: policy.autoDelete },
    });
    res.status(201).json(policy);
  } catch (e) { next(e); }
});

router.patch('/policies/:id', staffOnly, validateBody(policyPatchSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const policy = await prisma.retentionPolicy.findFirst({ where: { id: req.params.id, ...tf } });
    if (!policy) return res.status(404).json({ error: 'Policy nahi mili' });
    const data = {};
    if (req.body.retainDays !== undefined) data.retainDays = validateDays(req.body.retainDays);
    if (req.body.autoDelete !== undefined) data.autoDelete = !!req.body.autoDelete;
    const updated = await prisma.retentionPolicy.update({ where: { id: policy.id }, data });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id, action: 'retention.policy_update',
      entity: 'RetentionPolicy', entityId: policy.id, oldValue: policy, newValue: updated,
    });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/policies/:id', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const policy = await prisma.retentionPolicy.findFirst({ where: { id: req.params.id, ...tf } });
    if (!policy) return res.status(404).json({ error: 'Policy nahi mili' });
    await prisma.retentionPolicy.delete({ where: { id: policy.id } });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id, action: 'retention.policy_delete',
      entity: 'RetentionPolicy', entityId: policy.id, oldValue: policy,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Run: dryRun default true (preview). dryRun:false sirf explicit confirm par.
// Body: { dataType? (ek type ya sab policies), retainDays? (ad-hoc), dryRun? }
// ---------------------------------------------------------------------------
const runSchema = z.object({
  dataType: z.enum(DATA_TYPES).optional(),
  retainDays: z.number().int().min(7).max(3650).optional(),
  dryRun: z.boolean().default(true),
});

router.post('/run', staffOnly, validateBody(runSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { dataType, retainDays, dryRun } = req.body;

    if (dataType && retainDays) {
      // Ad-hoc run — kisi saved policy ke baghair
      const result = await runRetention(tf.tenantId, {
        dataType, retainDays, dryRun, runBy: req.user.id,
      });
      return res.json(result);
    }
    const result = await runAllPolicies(tf.tenantId, {
      dataType: dataType || null, dryRun, runBy: req.user.id,
    });
    if (result.skipped) return res.json(result);
    if (!result.results.length) {
      return res.json({ mode: dryRun ? 'dry_run' : 'live', results: [], note: 'Koi policy nahi — pehle policy banayein ya retainDays ke sath ad-hoc run karein' });
    }
    res.json({ mode: dryRun ? 'dry_run' : 'live', ...result });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Run history
// ---------------------------------------------------------------------------
router.get('/runs', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { dataType, mode, page = '1', limit = '20' } = req.query;
    const where = { ...tf };
    if (dataType && DATA_TYPES.includes(dataType)) where.dataType = dataType;
    if (mode === 'dry_run' || mode === 'live') where.mode = mode;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const [total, runs] = await Promise.all([
      prisma.retentionRun.count({ where }),
      prisma.retentionRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
        include: { policy: { select: { dataType: true, retainDays: true, autoDelete: true } } },
      }),
    ]);
    res.json({ total, page: p, pages: Math.ceil(total / l), runs });
  } catch (e) { next(e); }
});

router.get('/runs/:id', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const run = await prisma.retentionRun.findFirst({
      where: { id: req.params.id, ...tf },
      include: { policy: true },
    });
    if (!run) return res.status(404).json({ error: 'Run nahi mila' });
    res.json(run);
  } catch (e) { next(e); }
});

module.exports = router;
