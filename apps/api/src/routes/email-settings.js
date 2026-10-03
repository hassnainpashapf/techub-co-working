const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { invalidateTransporter, sendEmail } = require('../lib/mailer');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin'));

const settingsSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().optional().nullable(),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  fromName: z.string().optional().nullable(),
  fromEmail: z.string().email().optional().nullable(),
});

function mask(s) {
  if (!s) return null;
  return { ...s, password: s.password ? '••••••••' : null };
}

// Get current settings (password masked)
router.get('/', async (req, res, next) => {
  try {
    const s = await prisma.emailSetting.findUnique({ where: { tenantId: req.user.tenantId } });
    res.json({ settings: mask(s) });
  } catch (e) { next(e); }
});

// Save settings (upsert)
router.put('/', validateBody(settingsSchema), async (req, res, next) => {
  try {
    const data = { ...req.body, tenantId: req.user.tenantId };
    // Don't overwrite password with empty string
    if (!data.password) delete data.password;
    const s = await prisma.emailSetting.upsert({
      where: { tenantId: req.user.tenantId },
      create: data,
      update: data,
    });
    invalidateTransporter(req.user.tenantId);
    res.json({ settings: mask(s) });
  } catch (e) { next(e); }
});

// Send a test email
router.post('/test', validateBody(z.object({ to: z.string().email() })), async (req, res, next) => {
  try {
    const result = await sendEmail(req.user.tenantId, {
      to: req.body.to,
      subject: 'CoworkOS test email',
      html: '<p>If you received this, your email settings work correctly. 🎉</p>',
    });
    res.json({ result });
  } catch (e) { next(e); }
});

module.exports = router;
