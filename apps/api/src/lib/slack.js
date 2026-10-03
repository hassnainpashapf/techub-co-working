// Phase 36 Track 3: Slack incoming-webhook integration.
// Sends real Slack messages via the tenant's configured incoming webhook URL.
// The webhook URL is stored AES-256-GCM encrypted (lib/crypto) and outbound
// delivery goes through the SSRF-safe client (lib/safeFetch).
const { safePost } = require('./safeFetch');
const { encryptSecret, decryptSecret } = require('./crypto');
const prisma = require('./prisma');

const SUPPORTED_EVENTS = [
  { key: 'booking_created',  label: 'Booking created',  desc: 'Jab nayi booking bane' },
  { key: 'payment_received', label: 'Payment received', desc: 'Jab payment record ho' },
  { key: 'ticket_urgent',    label: 'Urgent ticket',    desc: 'Jab urgent priority ka ticket bane' },
  { key: 'visitor_checkin',  label: 'Visitor check-in', desc: 'Jab visitor check-in kare' },
];

const EVENT_KEYS = SUPPORTED_EVENTS.map((e) => e.key);

function assertWebhookUrl(url) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('Webhook URL required.');
  const u = new URL(url.trim());
  if (u.protocol !== 'https:') throw new Error('Webhook URL must be https.');
  // Slack incoming webhooks live under hooks.slack.com (or enterprise *.slack.com)
  if (!/(^|\.)hooks\.slack\.com$/.test(u.hostname) && !/(^|\.)slack\.com$/.test(u.hostname)) {
    throw new Error('Webhook URL must be a Slack incoming webhook (hooks.slack.com).');
  }
  return url.trim();
}

async function getIntegration(tenantId) {
  const row = await prisma.slackIntegration.findUnique({ where: { tenantId } });
  if (!row || !row.isActive) return null;
  return row;
}

async function sendSlackMessage(webhookUrl, payload) {
  const res = await safePost(webhookUrl, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(res.error || `Slack webhook failed: HTTP ${res.status}`);
  }
  return true;
}

function fmtMoney(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `Rs ${v.toLocaleString('en-PK')}` : 'Rs 0';
}

function buildMessage(event, data = {}) {
  const d = data || {};
  switch (event) {
    case 'booking_created':
      return {
        text: `📅 New booking: ${d.title || 'Booking'}${d.unitCode ? ` (${d.unitCode})` : ''}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: '📅 New Booking', emoji: true } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Title:*\n${d.title || '—'}` },
              { type: 'mrkdwn', text: `*Unit:*\n${d.unitCode || '—'}` },
              { type: 'mrkdwn', text: `*Start:*\n${d.startAt ? new Date(d.startAt).toLocaleString() : '—'}` },
              { type: 'mrkdwn', text: `*End:*\n${d.endAt ? new Date(d.endAt).toLocaleString() : '—'}` },
            ],
          },
        ],
      };
    case 'payment_received':
      return {
        text: `💰 Payment received: ${fmtMoney(d.amount)}${d.invoiceNumber ? ` (Invoice ${d.invoiceNumber})` : ''}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: '💰 Payment Received', emoji: true } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Amount:*\n${fmtMoney(d.amount)}` },
              { type: 'mrkdwn', text: `*Invoice:*\n${d.invoiceNumber || '—'}` },
              { type: 'mrkdwn', text: `*Method:*\n${d.method || '—'}` },
            ],
          },
        ],
      };
    case 'ticket_urgent':
      return {
        text: `🚨 URGENT ticket: ${d.title || d.ticketNumber || 'Ticket'}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: '🚨 Urgent Ticket', emoji: true } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Ticket:*\n${d.ticketNumber || d.title || '—'}` },
              { type: 'mrkdwn', text: `*Title:*\n${d.title || '—'}` },
              { type: 'mrkdwn', text: `*Priority:*\nurgent` },
            ],
          },
        ],
      };
    case 'visitor_checkin':
      return {
        text: `👋 Visitor checked in: ${d.name || 'Visitor'}${d.host ? ` (host: ${d.host})` : ''}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: '👋 Visitor Check-in', emoji: true } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Visitor:*\n${d.name || '—'}` },
              { type: 'mrkdwn', text: `*Host:*\n${d.host || '—'}` },
            ],
          },
        ],
      };
    default:
      return { text: `CoworkOS event: ${event}` };
  }
}

// Fire-and-forget from route handlers: never throws into the main flow.
async function notifyEvent(tenantId, event, data) {
  try {
    if (!tenantId || !EVENT_KEYS.includes(event)) return false;
    const row = await getIntegration(tenantId);
    if (!row) return false;
    const events = Array.isArray(row.events) ? row.events : [];
    if (!events.includes(event)) return false;
    const url = decryptSecret(row.webhookUrl);
    await sendSlackMessage(url, buildMessage(event, data));
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  SUPPORTED_EVENTS,
  EVENT_KEYS,
  assertWebhookUrl,
  getIntegration,
  sendSlackMessage,
  buildMessage,
  notifyEvent,
  encryptSecret,
  decryptSecret,
};
