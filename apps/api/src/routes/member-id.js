// Phase 37 Track 8: Digital Member ID Card.
// A branded, printable-style ID card for the member portal, plus a staff
// "verify identity" endpoint for reception. The QR payload reuses the same
// HMAC-signed token scheme as /api/member-qr so the existing
// /attendance/scan page can also scan this card. Stateless — no migration.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

// Must match apps/api/src/routes/member-qr.js so tokens are cross-compatible.
const QR_VERSION = 1;
const QR_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

const STAFF_VERIFY_ROLES = ['receptionist', 'manager', 'operations_manager', 'admin', 'ceo', 'super_admin'];

function qrSecret() {
  return process.env.JWT_ACCESS_SECRET || '';
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function b64urlDecode(s) {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
}

function signQr(payload) {
  const body = b64urlEncode(payload);
  const sig = crypto.createHmac('sha256', qrSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyQr(token) {
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
  if (!payload || payload.v !== QR_VERSION || !payload.memberId || !payload.tenantId) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp && Date.now() > payload.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

// Same member resolution as the member portal: memberId from JWT,
// falling back to an email match inside the tenant.
async function myMember(req) {
  const tf = tenantFilter(req);
  if (req.user.memberId) {
    const m = await prisma.member.findFirst({ where: { id: req.user.memberId, ...tf } });
    if (m) return m;
  }
  if (req.user.email) {
    const m = await prisma.member.findFirst({ where: { email: req.user.email, ...tf } });
    if (m) return m;
  }
  return null;
}

async function cardDetails(member, tenantId) {
  const contract = await prisma.contract.findFirst({
    where: { memberId: member.id, tenantId, status: 'active' },
    include: { plan: { select: { name: true } }, unit: { select: { name: true } } },
    orderBy: { startDate: 'desc' },
  });
  const exp = Date.now() + QR_TTL_MS;
  const qrPayload = signQr({
    v: QR_VERSION,
    memberId: member.id,
    userId: null,
    tenantId,
    exp,
  });
  return {
    name: member.name,
    memberId: member.id,
    memberCode: member.id.slice(-8).toUpperCase(),
    email: member.email,
    phone: member.phone,
    companyName: member.companyName,
    status: member.status,
    plan: contract?.plan?.name || null,
    unit: contract?.unit?.name || null,
    validFrom: contract?.startDate || member.createdAt,
    validTill: contract?.endDate || null,
    qrPayload,
    qrExpiresAt: new Date(exp).toISOString(),
  };
}

// GET /api/member-id/card — the logged-in member's digital ID card data.
router.get('/card', async (req, res, next) => {
  try {
    const member = await myMember(req);
    if (!member) {
      return res.status(404).json({ error: { message: 'No member profile is linked to your account.' } });
    }
    return res.json(await cardDetails(member, req.user.tenantId));
  } catch (err) {
    return next(err);
  }
});

// POST /api/member-id/verify — staff verifies a member's ID card token
// (reception desk "who is this?" lookup; does NOT check in).
const verifySchema = z.object({ qrPayload: z.string().min(1) });

router.post(
  '/verify',
  requireRole(...STAFF_VERIFY_ROLES),
  validateBody(verifySchema),
  async (req, res, next) => {
    try {
      const { ok, payload, reason } = verifyQr(req.body.qrPayload);
      if (!ok) {
        const msg =
          reason === 'expired'
            ? 'This ID card has expired. Ask the member to refresh it from their portal.'
            : 'Invalid member ID card.';
        return res.status(400).json({ error: { message: msg } });
      }
      const tf = tenantFilter(req);
      if (payload.tenantId !== req.user.tenantId) {
        return res.status(400).json({ error: { message: 'This ID card is not for this organization.' } });
      }
      const member = await prisma.member.findFirst({ where: { id: payload.memberId, ...tf } });
      if (!member) {
        return res.status(404).json({ error: { message: 'Member not found.' } });
      }
      const details = await cardDetails(member, req.user.tenantId);
      writeAudit({
        tenantId: req.user.tenantId,
        actorId: req.user.sub,
        action: 'member.id_verify',
        entity: 'Member',
        entityId: member.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.json({ verified: true, member: details });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
