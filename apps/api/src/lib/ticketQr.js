// Phase 44 Track 4: Event ticket QR tokens (HMAC-SHA256, stateless).
// Track 3 (purchase flow) aur Track 4 (entry scanning) dono yahi lib use karte hain
// taake sign/verify ek jaga ho. Token format member-qr.js jaisa hai:
//   base64url(payload) + "." + base64url(HMAC-SHA256(payload))
// Payload: { v: 1, tenantId, eventId, ticketId, exp? }
const crypto = require('crypto');

const QR_VERSION = 1;

function qrSecret() {
  return process.env.JWT_ACCESS_SECRET || '';
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function b64urlDecode(s) {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
}

function signTicketQr({ tenantId, eventId, ticketId, ttlMs }) {
  const payload = { v: QR_VERSION, tenantId, eventId, ticketId };
  if (ttlMs) payload.exp = Date.now() + ttlMs;
  const body = b64urlEncode(payload);
  const sig = crypto.createHmac('sha256', qrSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyTicketQr(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', qrSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let payload;
  try {
    payload = b64urlDecode(body);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || payload.v !== QR_VERSION || !payload.ticketId || !payload.eventId || !payload.tenantId) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp && Date.now() > payload.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

module.exports = { signTicketQr, verifyTicketQr, QR_VERSION };
