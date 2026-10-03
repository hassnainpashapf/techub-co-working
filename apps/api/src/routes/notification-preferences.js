// Phase 27 Track 4: Notification preferences API.
// User apni khud ki preferences dekhe / change kare (opt-out system).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { getUserPreferences } = require('../lib/preferences');
const {
  NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
} = require('../lib/notificationEvents');

const router = express.Router();

router.use(authenticate, requireTenantUser);

// Mera poora preferences matrix
router.get('/', async (req, res, next) => {
  try {
    const matrix = await getUserPreferences(req.user.sub);
    res.json({
      matrix,
      events: NOTIFICATION_EVENTS,
      channels: NOTIFICATION_CHANNELS,
      eventLabels: NOTIFICATION_EVENT_LABELS,
      channelLabels: NOTIFICATION_CHANNEL_LABELS,
    });
  } catch (e) { next(e); }
});

// Ek preference set/update karo (upsert)
const prefSchema = z.object({
  eventType: z.string().refine((e) => NOTIFICATION_EVENTS.includes(e), { message: 'Invalid event type' }),
  channel: z.string().refine((c) => NOTIFICATION_CHANNELS.includes(c), { message: 'Invalid channel' }),
  enabled: z.boolean(),
});

router.put('/', validateBody(prefSchema), async (req, res, next) => {
  try {
    const { eventType, channel, enabled } = req.body;
    const pref = await prisma.notificationPreference.upsert({
      where: { userId_eventType_channel: { userId: req.user.sub, eventType, channel } },
      update: { enabled },
      create: {
        tenantId: req.user.tenantId,
        userId: req.user.sub,
        eventType,
        channel,
        enabled,
      },
    });
    res.json({ preference: pref });
    // Phase 28: audit (fire-and-forget)
    writeAudit({
      tenantId: req.user.tenantId, actorId: req.user.sub, action: 'notification_preference.update',
      entity: 'NotificationPreference', entityId: pref.id,
      newValue: { eventType, channel, enabled },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
  } catch (e) { next(e); }
});

module.exports = router;
