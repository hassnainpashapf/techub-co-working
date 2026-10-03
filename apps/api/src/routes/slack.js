// Phase 36 Track 3: Slack Integration.
// GET /api/slack/config   — current config (webhook URL masked)
// PUT /api/slack/config   — save webhook URL + event toggles
// POST /api/slack/test    — send a test message
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const {
  SUPPORTED_EVENTS,
  EVENT_KEYS,
  assertWebhookUrl,
  sendSlackMessage,
  encryptSecret,
} = require('../lib/slack');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin'));

const configSchema = z.object({
  webhookUrl: z.string().min(1).max(2000).optional(), // empty = remove integration
  channel: z.string().max(100).optional().nullable(),
  events: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

function maskConfig(row) {
  if (!row) return { configured: false, events: [], channel: null, isActive: false };
  return {
    configured: true,
    webhookMasked: '••••••••',
    channel: row.channel || null,
    events: Array.isArray(row.events) ? row.events : [],
    isActive: row.isActive,
    updatedAt: row.updatedAt,
  };
}

// GET /api/slack/config
router.get('/config', async (req, res, next) => {
  try {
    const row = await prisma.slackIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });
    res.json({ config: maskConfig(row), supportedEvents: SUPPORTED_EVENTS });
  } catch (e) { next(e); }
});

// PUT /api/slack/config
router.put('/config', validateBody(configSchema), async (req, res, next) => {
  try {
    const { webhookUrl, channel, events, isActive } = req.body;
    const validEvents = (events || []).filter((e) => EVENT_KEYS.includes(e));

    // Empty URL = remove integration
    if (!webhookUrl || !webhookUrl.trim()) {
      await prisma.slackIntegration.deleteMany({ where: { tenantId: req.user.tenantId } });
      await writeAudit(req, 'slack.removed', 'SlackIntegration', req.user.tenantId, null, {});
      return res.json({ config: maskConfig(null) });
    }

    let cleanUrl;
    try {
      cleanUrl = assertWebhookUrl(webhookUrl);
    } catch (e) {
      return res.status(400).json({ error: { message: e.message } });
    }

    const row = await prisma.slackIntegration.upsert({
      where: { tenantId: req.user.tenantId },
      create: {
        tenantId: req.user.tenantId,
        webhookUrl: encryptSecret(cleanUrl),
        channel: channel || null,
        events: validEvents,
        isActive: !!isActive,
      },
      update: {
        webhookUrl: encryptSecret(cleanUrl),
        channel: channel || null,
        events: validEvents,
        isActive: !!isActive,
      },
    });
    await writeAudit(req, 'slack.configured', 'SlackIntegration', row.id, null, {
      events: validEvents,
      isActive: !!isActive,
    });
    res.json({ config: maskConfig(row) });
  } catch (e) { next(e); }
});

// POST /api/slack/test — sends a real test message through the configured webhook
router.post('/test', async (req, res, next) => {
  try {
    const row = await prisma.slackIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });
    if (!row || !row.isActive) {
      return res.status(400).json({ error: { message: 'Slack integration is not configured.' } });
    }
    let url;
    try {
      const { decryptSecret } = require('../lib/slack');
      url = decryptSecret(row.webhookUrl);
    } catch (e) {
      return res.status(500).json({ error: { message: 'Stored webhook URL could not be decrypted.' } });
    }
    await sendSlackMessage(url, { text: '✅ CoworkOS Slack integration test — connection works!' });
    await writeAudit(req, 'slack.test', 'SlackIntegration', row.id, null, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
