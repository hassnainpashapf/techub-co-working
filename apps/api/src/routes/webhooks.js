const express = require('express');
const { z } = require('zod');
const crypto = require('crypto');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { WEBHOOK_EVENTS } = require('../lib/webhooks');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const ADMIN_ROLES = ['ceo', 'admin', 'super_admin'];
const adminWrite = requireRole(...ADMIN_ROLES);

const webhookSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.string()).min(1).refine(
    (evs) => evs.every((e) => e === '*' || WEBHOOK_EVENTS.includes(e)),
    { message: 'Invalid event name' }
  ),
  secret: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

// List webhooks — secret is masked (never returned); use /:id/secret to rotate.
router.get('/', adminWrite, async (req, res, next) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { ...tenantFilter(req) },
      include: { _count: { select: { deliveries: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const masked = webhooks.map((w) => ({ ...w, secret: null, hasSecret: !!w.secret }));
    res.json({ webhooks: masked, availableEvents: WEBHOOK_EVENTS });
  } catch (e) { next(e); }
});

// Create webhook
router.post('/', adminWrite, validateBody(webhookSchema), async (req, res, next) => {
  try {
    const webhook = await prisma.webhook.create({
      data: {
        ...req.body,
        secret: req.body.secret || crypto.randomBytes(24).toString('hex'),
        tenantId: req.user.tenantId,
      },
    });
    await writeAudit(req, 'webhook.create', 'Webhook', webhook.id, null, { name: webhook.name, url: webhook.url });
    res.status(201).json({ webhook });
  } catch (e) { next(e); }
});

// Update webhook
router.patch('/:id', adminWrite, validateBody(webhookSchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.webhook.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Webhook not found' });
    const data = { ...req.body };
    // Never overwrite the secret with a masked/blank value from the edit form.
    if (data.secret == null || data.secret === '' || /^[•*]+$/.test(String(data.secret))) delete data.secret;
    const webhook = await prisma.webhook.update({ where: { id: req.params.id }, data });
    await writeAudit(req, 'webhook.update', 'Webhook', webhook.id, null, { name: webhook.name });
    res.json({ webhook: { ...webhook, secret: null, hasSecret: !!webhook.secret } });
  } catch (e) { next(e); }
});

// Regenerate signing secret — returned ONCE, then masked everywhere.
router.post('/:id/secret', adminWrite, async (req, res, next) => {
  try {
    const existing = await prisma.webhook.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Webhook not found' });
    const secret = crypto.randomBytes(32).toString('hex');
    await prisma.webhook.update({ where: { id: req.params.id }, data: { secret } });
    await writeAudit(req, 'webhook.secret.rotate', 'Webhook', req.params.id, null, { name: existing.name });
    res.json({ secret });
  } catch (e) { next(e); }
});

// Delete webhook
router.delete('/:id', adminWrite, async (req, res, next) => {
  try {
    const existing = await prisma.webhook.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!existing) return res.status(404).json({ error: 'Webhook not found' });
    await prisma.webhook.delete({ where: { id: req.params.id } });
    await writeAudit(req, 'webhook.delete', 'Webhook', req.params.id, { name: existing.name }, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Delivery logs
router.get('/:id/deliveries', adminWrite, async (req, res, next) => {
  try {
    const webhook = await prisma.webhook.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId: webhook.id, ...tenantFilter(req) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ deliveries });
  } catch (e) { next(e); }
});

// Send a test event
router.post('/:id/test', adminWrite, async (req, res, next) => {
  try {
    const webhook = await prisma.webhook.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    const { testWebhook } = require('../lib/webhooks');
    await testWebhook(webhook);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Resend a failed delivery — resets attempts and re-enqueues with the same retry schedule.
router.post('/:id/deliveries/:deliveryId/resend', adminWrite, async (req, res, next) => {
  try {
    const webhook = await prisma.webhook.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    if (!webhook.active) return res.status(400).json({ error: 'Webhook is paused' });
    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id: req.params.deliveryId, webhookId: webhook.id, ...tenantFilter(req) },
    });
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    const { WEBHOOK_RETRY_DELAYS, WEBHOOK_MAX_ATTEMPTS, registerWebhookHandler } = require('../lib/webhooks');
    registerWebhookHandler();
    let jobs = null;
    try { jobs = require('../lib/jobs'); } catch { /* fall through */ }
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'pending', attempts: 0, error: null, responseCode: null },
    });
    if (jobs && typeof jobs.enqueue === 'function') {
      await jobs.enqueue(
        'webhook',
        { webhookId: webhook.id, event: delivery.event, payload: delivery.payload, deliveryId: delivery.id },
        { tenantId: webhook.tenantId, maxAttempts: WEBHOOK_MAX_ATTEMPTS, retryDelays: WEBHOOK_RETRY_DELAYS }
      );
    }
    await writeAudit(req, 'webhook.delivery.resend', 'WebhookDelivery', delivery.id, null, { event: delivery.event });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
