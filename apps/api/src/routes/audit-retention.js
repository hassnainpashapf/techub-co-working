// Phase 32 Track 8: Audit log retention — archives listing + settings + manual run.
// Mount: app.use('/api/audit-retention', require('./routes/audit-retention'));
// Roles: ceo / admin / super_admin (tenant context required).

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { runRetention, getRetentionDays, setRetentionDays } = require('../lib/auditRetention');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('ceo', 'admin', 'super_admin'));

function needTenant(req) {
  if (!req.user.tenantId) {
    const err = new Error('Tenant context required');
    err.status = 400;
    throw err;
  }
  return req.user.tenantId;
}

// GET /api/audit-retention/archives — archive history
router.get('/archives', async (req, res, next) => {
  try {
    const tenantId = needTenant(req);
    const archives = await prisma.auditArchive.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ archives });
  } catch (err) {
    return next(err);
  }
});

// GET /api/audit-retention/settings — current retention days
router.get('/settings', async (req, res, next) => {
  try {
    const tenantId = needTenant(req);
    const retentionDays = await getRetentionDays(tenantId);
    return res.json({ retentionDays });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/audit-retention/settings — update retention days
const settingsSchema = z.object({
  retentionDays: z.number().int().min(30).max(3650),
});
router.put('/settings', validateBody(settingsSchema), async (req, res, next) => {
  try {
    const tenantId = needTenant(req);
    const retentionDays = await setRetentionDays(tenantId, req.body.retentionDays);
    writeAudit({
      tenantId,
      actorId: req.user.id,
      action: 'audit.retention.settings.update',
      entity: 'Setting',
      newValue: { retentionDays },
    }).catch(() => {});
    return res.json({ retentionDays });
  } catch (err) {
    return next(err);
  }
});

// POST /api/audit-retention/run — manual retention trigger
router.post('/run', async (req, res, next) => {
  try {
    const tenantId = needTenant(req);
    const result = await runRetention(tenantId);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
