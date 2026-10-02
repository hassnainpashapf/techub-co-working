const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin'));

// Tenant-level key/value settings. GET → {key: value}; PUT upserts each pair.
const settingsSchema = z.object({
  settings: z.record(z.string(), z.string().min(1)),
});

router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.setting.findMany({ where: tenantFilter(req) });
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

router.put('/', validateBody(settingsSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const entries = Object.entries(req.body.settings);
    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { tenantId_key: { tenantId: tf.tenantId, key } },
        update: { value },
        create: { tenantId: tf.tenantId, key, value },
      });
    }
    const rows = await prisma.setting.findMany({ where: tf });
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
