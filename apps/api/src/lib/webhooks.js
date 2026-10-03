// Webhook delivery: fire-and-forget POST to tenant webhook URLs with HMAC signature.
const crypto = require('crypto');
const prisma = require('./prisma');

const WEBHOOK_EVENTS = [
  'member.created',
  'booking.created',
  'booking.cancelled',
  'payment.received',
  'invoice.created',
  'ticket.created',
  'ticket.updated',
  'visitor.checkin',
  'contract.created',
];

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

async function deliver(webhook, event, payload) {
  const delivery = await prisma.webhookDelivery.create({
    data: {
      tenantId: webhook.tenantId,
      webhookId: webhook.id,
      event,
      payload,
      status: 'pending',
      attempts: 1,
    },
  });
  try {
    const body = JSON.stringify({ event, tenantId: webhook.tenantId, at: new Date().toISOString(), data: payload });
    const headers = { 'Content-Type': 'application/json', 'X-Webhook-Event': event };
    if (webhook.secret) headers['X-Webhook-Signature'] = sign(payload, webhook.secret);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(webhook.url, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(timer);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: res.ok ? 'success' : 'failed', responseCode: res.status, error: res.ok ? null : `HTTP ${res.status}` },
    });
  } catch (e) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', error: e.message?.slice(0, 500) || 'Delivery failed' },
    });
  }
}

// Fire webhooks for an event. Never throws — runs in background.
function emitWebhook(tenantId, event, payload) {
  if (!tenantId || !WEBHOOK_EVENTS.includes(event)) return;
  setImmediate(async () => {
    try {
      const hooks = await prisma.webhook.findMany({
        where: { tenantId, active: true },
      });
      const matched = hooks.filter((h) => h.events.includes(event) || h.events.includes('*'));
      await Promise.all(matched.map((h) => deliver(h, event, payload)));
    } catch (e) {
      console.error('[webhook] emit failed:', e.message);
    }
  });
}

// Send a test event directly to one webhook
async function testWebhook(webhook) {
  await deliver(webhook, 'webhook.test', { test: true, message: 'Test event from CoworkOS', at: new Date().toISOString() });
}

module.exports = { emitWebhook, testWebhook, WEBHOOK_EVENTS };
