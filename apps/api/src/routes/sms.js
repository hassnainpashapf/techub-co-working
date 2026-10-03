// Phase 27 Track 1: SMS routes — send + logs.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { sendSms, twilioConfigured } = require('../lib/sms');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const MANAGER_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'finance'];
const canSend = requireRole(...MANAGER_ROLES);

const sendSchema = z.object({
  to: z.string().min(7).max(20),
  body: z.string().min(1).max(1600),
});

// Send an SMS
router.post('/send', canSend, validateBody(sendSchema), async (req, res, next) => {
  try {
    const { to, body } = req.body;
    const result = await sendSms(req.user.tenantId, to, body);
    await writeAudit(req, 'sms.sent', 'SmsLog', null, null, {
      to,
      provider: result.provider,
      sent: result.sent,
    });
    if (!result.sent) {
      return res.status(502).json({ error: { message: result.error || 'SMS failed to send.' } });
    }
    res.status(201).json({ result });
  } catch (e) { next(e); }
});

// List SMS logs (latest first)
router.get('/logs', canSend, async (req, res, next) => {
  try {
    const logs = await prisma.smsLog.findMany({
      where: { ...tenantFilter(req) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ logs, configured: twilioConfigured() });
  } catch (e) {
    // Model abhi migrate nahi hui ho to khali list
    if (e.message && e.message.includes('smsLog')) {
      return res.json({ logs: [], configured: twilioConfigured(), pendingMigration: true });
    }
    next(e);
  }
});

module.exports = router;
