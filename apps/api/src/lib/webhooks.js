// Webhook delivery: enqueue via job queue (with retries) when available,
// otherwise fire-and-forget direct POST. HMAC-signed (X-CoworkOS-Signature),
// SSRF-protected via safeFetch, 10s timeout.
const crypto = require('crypto');
const prisma = require('./prisma');
const { safePost } = require('./safeFetch');

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

// Retry schedule: 1m, 5m, 30m, 2h, then 2h — max 8 attempts total.
const WEBHOOK_RETRY_DELAYS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 2 * 3600e3, 2 * 3600e3, 2 * 3600e3];
const WEBHOOK_MAX_ATTEMPTS = 8;

const SIGNATURE_HEADER = 'X-CoworkOS-Signature';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

// Sign: v1 = HMAC-SHA256(secret, "<unixTimestamp>.<rawBody>")
// Header format: t=<unixTimestamp>,v1=<hex>
function signPayload(secret, rawBody, timestampSec) {
  const ts = String(timestampSec);
  const v1 = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return { header: `t=${ts},v1=${v1}`, timestamp: ts, signature: v1 };
}

// Verify an incoming CoworkOS webhook signature (for receivers).
// Returns { valid, reason }. Enforces 5-minute replay window.
function verifyWebhookSignature(secret, rawBody, headerValue, nowMs = Date.now()) {
  if (!secret || !headerValue) return { valid: false, reason: 'missing signature' };
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(headerValue).trim());
  if (!m) return { valid: false, reason: 'malformed signature header' };
  const ts = Number(m[1]);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'bad timestamp' };
  if (Math.abs(nowMs - ts * 1000) > REPLAY_WINDOW_MS) {
    return { valid: false, reason: 'timestamp outside 5-minute replay window' };
  }
  const expected = crypto.createHmac('sha256', secret).update(`${m[1]}.${rawBody}`).digest();
  const got = Buffer.from(m[2], 'hex');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  return { valid: true };
}

// Optional dependency: Track 1's job queue (src/lib/jobs.js).
function getJobs() {
  try {
    return require('./jobs');
  } catch (e) {
    return null;
  }
}

// Pure HTTP delivery — no DB writes. Returns { ok, responseCode, error }.
// SSRF-protected: URL re-validated on every redirect hop, private IPs blocked.
async function performHttpDelivery(webhook, event, payload) {
  const envelope = { event, tenantId: webhook.tenantId, at: new Date().toISOString(), data: payload };
  const body = JSON.stringify(envelope);
  const headers = { 'Content-Type': 'application/json', 'X-Webhook-Event': event };
  if (webhook.secret) {
    const { header } = signPayload(webhook.secret, body, Math.floor(Date.now() / 1000));
    headers[SIGNATURE_HEADER] = header;
  }
  const result = await safePost(webhook.url, { headers, body });
  if (result.ok) {
    return { ok: true, responseCode: result.status, error: null };
  }
  return {
    ok: false,
    responseCode: result.status,
    error: (result.error || 'Delivery failed').slice(0, 500),
  };
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
        {
          tenantId: webhook.tenantId,
          maxAttempts: WEBHOOK_MAX_ATTEMPTS,
          retryDelays: WEBHOOK_RETRY_DELAYS,
        }
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
      // Throw so the queue retries with the custom backoff schedule.
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

module.exports = {
  emitWebhook,
  testWebhook,
  dispatchWebhook,
  registerWebhookHandler,
  signPayload,
  verifyWebhookSignature,
  SIGNATURE_HEADER,
  WEBHOOK_EVENTS,
  WEBHOOK_RETRY_DELAYS,
  WEBHOOK_MAX_ATTEMPTS,
};
