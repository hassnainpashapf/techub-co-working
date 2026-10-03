// Phase 27 Track 2/5: WhatsApp notifications API.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { sendWhatsapp } = require('../lib/whatsapp');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF_ROLES);

const sendSchema = z.object({
  to: z.string().min(5),
  template: z.string().min(1),
  params: z.record(z.any()).optional(),
});

// Send a WhatsApp message (Meta Cloud API, or console fallback when unconfigured)
router.post('/send', staffOnly, validateBody(sendSchema), async (req, res, next) => {
  try {
    const { to, template, params } = req.body;
    const result = await sendWhatsapp(req.user.tenantId, to, template, params || {});
    await writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'whatsapp.send',
      entity: 'WhatsappLog',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: result.sent, ...result });
  } catch (err) {
    return next(err);
  }
});

// List WhatsApp send logs
router.get('/logs', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.whatsappLog) {
      return res.json({ logs: [], note: 'whatsapp_logs table not migrated yet' });
    }
    const logs = await prisma.whatsappLog.findMany({
      where: { ...tenantFilter(req) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ logs });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
