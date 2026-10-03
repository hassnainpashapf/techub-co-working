// Phase 32 Track 6: Login Security — alerts + IP allowlist management.
// Mount: app.use('/api/login-security', require('./routes/login-security'));
// Roles: ceo / admin / super_admin.

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { ALLOWLIST_KEY, isValidIpEntry, getIpAllowlist } = require('../lib/loginSecurity');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

// ---------------------------------------------------------- alerts --------
router.get('/alerts', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { acknowledged } = req.query;
    const where = { ...tf };
    if (acknowledged === 'true') where.acknowledgedAt = { not: null };
    else if (acknowledged === 'false') where.acknowledgedAt = null;
    const alerts = await prisma.loginAlert.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return res.json({ alerts });
  } catch (err) {
    return next(err);
  }
});

router.post('/alerts/:id/acknowledge', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const alert = await prisma.loginAlert.update({
      where: { id: req.params.id },
      data: { acknowledgedAt: new Date() },
    });
    if (alert.tenantId !== tf.tenantId) {
      return res.status(404).json({ error: { message: 'Alert not found' } });
    }
    await writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.id,
      action: 'security.alert_ack',
      entity: 'LoginAlert',
      entityId: alert.id,
    }).catch(() => {});
    return res.json({ alert });
  } catch (err) {
    return next(err);
  }
});

// -------------------------------------------------------- allowlist ------
router.get('/ip-allowlist', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const allowlist = await getIpAllowlist(tf.tenantId);
    return res.json({ allowlist, enabled: allowlist.length > 0 });
  } catch (err) {
    return next(err);
  }
});

const allowlistSchema = z.object({
  ips: z.array(z.string()).max(200),
});

router.put('/ip-allowlist', validateBody(allowlistSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const raw = (req.body.ips || []).map((s) => String(s).trim()).filter(Boolean);
    const unique = [...new Set(raw)];
    const invalid = unique.filter((s) => !isValidIpEntry(s));
    if (invalid.length) {
      return res.status(400).json({
        error: { message: `Invalid IP/CIDR entries: ${invalid.slice(0, 5).join(', ')}` },
      });
    }
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId: tf.tenantId, key: ALLOWLIST_KEY } },
      update: { value: JSON.stringify(unique) },
      create: { tenantId: tf.tenantId, key: ALLOWLIST_KEY, value: JSON.stringify(unique) },
    });
    await writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.id,
      action: 'security.ip_allowlist_update',
      entity: 'Setting',
      entityId: ALLOWLIST_KEY,
    }).catch(() => {});
    return res.json({ allowlist: unique, enabled: unique.length > 0 });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
