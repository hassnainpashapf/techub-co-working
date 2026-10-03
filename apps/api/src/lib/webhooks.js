// Webhook delivery: enqueue via job queue (with retries) when available,
// otherwise fire-and-forget direct POST. HMAC-signed, 10s timeout.
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

// Optional dependency: Track 1's job queue (src/lib/jobs.js).
// Expected interface: enqueue(queue, data, opts), registerHandler(queue, fn).
// fn receives a job; job.data holds the payload; throwing triggers a retry.
function getJobs() {
  try {
    return require('./jobs');
  } catch (e) {
    return null;
  }
}

// Pure HTTP delivery — no DB writes. Returns { ok, responseCode, error }.
async function performHttpDelivery(webhook, event, payload) {
  const body = JSON.stringify({ event, tenantId: webhook.tenantId, at: new Date().toISOString(), data: payload });
  const headers = { 'Content-Type': 'application/json', 'X-Webhook-Event': event };
  if (webhook.secret) headers['X-Webhook-Signature'] = sign(payload, webhook.secret);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(webhook.url, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(timer);
    return {
      ok: res.ok,
      responseCode: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, responseCode: null, error: e.message?.slice(0, 500) || 'Delivery failed' };
  }
}

// Direct (synchronous) delivery with its own delivery-log row.
// Fallback path when the job queue is unavailable.
async function deliver(webhook, event, payload, existingDeliveryId) {
  let deliveryId = existingDeliveryId || null;
  try {
    if (!deliveryId) {
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
      deliveryId = delivery.id;
    }
    const result = await performHttpDelivery(webhook, event, payload);
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: result.ok ? 'success' : 'failed',
        attempts: 1,
        responseCode: result.responseCode,
        error: result.error,
      },
    });
  } catch (e) {
    if (deliveryId) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'failed', error: e.message?.slice(0, 500) || 'Delivery failed' },
      }).catch(() => {});
    }
  }
}

// Queue-aware dispatch: enqueue a 'webhook' job; fall back to direct delivery
// when the job queue module is missing or enqueue fails. Never throws.
async function dispatchWebhook(webhook, event, payload) {
  ensureHandlerRegistered();
  const jobs = getJobs();
  if (jobs && typeof jobs.enqueue === 'function') {
    try {
      // Create the log row up-front so retries update the same entry.
      const delivery = await prisma.webhookDelivery.create({
        data: {
          tenantId: webhook.tenantId,
          webhookId: webhook.id,
          event,
          payload,
          status: 'pending',
          attempts: 0,
        },
      });
      await jobs.enqueue(
        'webhook',
        { webhookId: webhook.id, event, payload, deliveryId: delivery.id },
        { tenantId: webhook.tenantId }
      );
      return;
    } catch (e) {
      console.error('[webhook] enqueue failed, falling back to direct:', e.message);
    }
  }
  await deliver(webhook, event, payload);
}

// Register the queue consumer for webhook jobs. Safe to call repeatedly;
// registers at most once. Returns true when a handler was registered.
let handlerRegistered = false;
function registerWebhookHandler() {
  if (handlerRegistered) return true;
  const jobs = getJobs();
  if (!jobs || typeof jobs.registerHandler !== 'function') return false;
  jobs.registerHandler('webhook', async (job) => {
    const data = (job && job.data) || job || {};
    const { webhookId, event, payload, deliveryId } = data;
    const webhook = webhookId ? await prisma.webhook.findUnique({ where: { id: webhookId } }) : null;
    if (!webhook || !webhook.active) {
      // Deleted or deactivated — log and do NOT retry.
      if (deliveryId) {
        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: { status: 'failed', error: 'Webhook deleted or deactivated' },
        }).catch(() => {});
      }
      return;
    }
    const attempt = (job && (job.attempts ?? job.attemptNumber)) || 1;
    const result = await performHttpDelivery(webhook, event, payload);
    if (deliveryId) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: result.ok ? 'success' : 'failed',
          attempts: attempt,
          responseCode: result.responseCode,
          error: result.error,
        },
      }).catch(() => {});
    }
    if (!result.ok) {
      // Throw so the queue retries with backoff.
      throw new Error(result.error || `Webhook delivery failed (HTTP ${result.responseCode})`);
    }
  });
  handlerRegistered = true;
  return true;
}

// Lazily register on first dispatch (jobs.js may load after this module).
function ensureHandlerRegistered() {
  if (handlerRegistered) return;
  try {
    registerWebhookHandler();
  } catch (e) {
    // Try again on next dispatch.
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
      await Promise.all(matched.map((h) => dispatchWebhook(h, event, payload)));
    } catch (e) {
      console.error('[webhook] emit failed:', e.message);
    }
  });
}

// Send a test event directly to one webhook (immediate feedback for the UI).
async function testWebhook(webhook) {
  await deliver(webhook, 'webhook.test', { test: true, message: 'Test event from CoworkOS', at: new Date().toISOString() });
}

module.exports = { emitWebhook, testWebhook, dispatchWebhook, registerWebhookHandler, WEBHOOK_EVENTS };
