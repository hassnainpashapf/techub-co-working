// Phase 29 Track 6: Member QR check-in.
// Each member gets a long-lived HMAC-signed QR token; reception scans it
// to mark attendance without typing anything.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter, todayDateOnly } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const QR_VERSION = 1;
const QR_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

const STAFF_SCAN_ROLES = ['receptionist', 'manager', 'operations_manager', 'admin', 'ceo', 'super_admin'];

function qrSecret() {
  return process.env.JWT_ACCESS_SECRET || '';
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function b64urlDecode(s) {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
}

// token = base64url(payload) + "." + base64url(HMAC-SHA256(payload))
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

function qrErrorMessage(reason) {
  switch (reason) {
    case 'expired': return 'This QR code has expired. Please ask the member to refresh it from their portal.';
    case 'bad-signature': return 'Invalid QR code (signature mismatch).';
    case 'malformed': return 'Invalid QR code format.';
    default: return 'Invalid QR code.';
  }
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

// GET /api/member-qr/me — the logged-in member's signed QR token.
// The frontend renders this string as a QR image.
router.get('/me', async (req, res, next) => {
  try {
    const member = await myMember(req);
    if (!member) {
      return res.status(404).json({ error: { message: 'No member profile is linked to your account.' } });
    }
    const exp = Date.now() + QR_TTL_MS;
    const token = signQr({
      v: QR_VERSION,
      memberId: member.id,
      userId: req.user.sub,
      tenantId: req.user.tenantId,
      exp,
    });
    return res.json({
      token,
      member: { id: member.id, name: member.name },
      expiresAt: new Date(exp).toISOString(),
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/member-qr/scan — staff scans a member QR to check them in.
const scanSchema = z.object({ token: z.string().min(1) });

router.post(
  '/scan',
  requireRole(...STAFF_SCAN_ROLES),
  validateBody(scanSchema),
  async (req, res, next) => {
    try {
      const { ok, payload, reason } = verifyQr(req.body.token);
      if (!ok) {
        return res.status(400).json({ error: { message: qrErrorMessage(reason) } });
      }
      const tf = tenantFilter(req);
      // Tenant binding: a QR is only valid inside its own organization.
      if (payload.tenantId !== req.user.tenantId) {
        return res.status(400).json({ error: { message: 'This QR code is not for this organization.' } });
      }
      const member = await prisma.member.findFirst({
        where: { id: payload.memberId, ...tf },
        include: { user: { select: { id: true } } },
      });
      if (!member) {
        return res.status(404).json({ error: { message: 'Member not found.' } });
      }
      // AttendanceRecord is keyed by userId — resolve the member's login.
      let userId = (member.user && member.user.id) || payload.userId || null;
      if (!userId && member.email) {
        const u = await prisma.user.findFirst({
          where: { email: member.email, ...tf },
          select: { id: true },
        });
        if (u) userId = u.id;
      }
      if (!userId) {
        return res.status(400).json({
          error: { message: 'This member has no linked login account, so attendance cannot be marked.' },
        });
      }
      const date = todayDateOnly();
      const existing = await prisma.attendanceRecord.findFirst({
        where: { ...tf, userId, date },
      });
      if (existing && existing.checkIn) {
        return res.json({
          alreadyCheckedIn: true,
          member: { id: member.id, name: member.name },
          checkedInAt: existing.checkIn,
        });
      }
      let record;
      if (existing) {
        record = await prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: { checkIn: new Date() },
        });
      } else {
        record = await prisma.attendanceRecord.create({
          data: { ...tf, userId, date, checkIn: new Date() },
        });
      }
      writeAudit({
        tenantId: req.user.tenantId,
        actorId: req.user.sub,
        action: 'attendance.qr_checkin',
        entity: 'AttendanceRecord',
        entityId: record.id,
        newValue: { memberId: member.id, userId },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.json({
        checkedIn: true,
        member: { id: member.id, name: member.name },
        checkedInAt: record.checkIn,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// Phase 37 Track 9: Reception desk manual check-in/out by memberId
// (for walk-ins whose QR can't be scanned). No migration, additive only.
const manualSchema = z.object({ memberId: z.string().min(1) });

async function resolveMemberUserId(member, tf) {
  // FK lives on User.memberId, not on Member.
  const u = await prisma.user.findFirst({
    where: { memberId: member.id, ...tf },
    select: { id: true },
  });
  if (u) return u.id;
  if (member.email) {
    const e = await prisma.user.findFirst({
      where: { email: member.email, ...tf },
      select: { id: true },
    });
    if (e) return e.id;
  }
  return null;
}

router.post(
  '/manual-check-in',
  requireRole(...STAFF_SCAN_ROLES),
  validateBody(manualSchema),
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const member = await prisma.member.findFirst({
        where: { id: req.body.memberId, ...tf },
        select: { id: true, name: true, email: true },
      });
      if (!member) return res.status(404).json({ error: { message: 'Member not found.' } });
      const userId = await resolveMemberUserId(member, tf);
      if (!userId) {
        return res.status(400).json({
          error: { message: 'This member has no linked login account, so attendance cannot be marked.' },
        });
      }
      const date = todayDateOnly();
      const existing = await prisma.attendanceRecord.findFirst({ where: { ...tf, userId, date } });
      if (existing && existing.checkIn) {
        return res.json({
          alreadyCheckedIn: true,
          member: { id: member.id, name: member.name },
          checkedInAt: existing.checkIn,
        });
      }
      let record;
      if (existing) {
        record = await prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: { checkIn: new Date() },
        });
      } else {
        record = await prisma.attendanceRecord.create({
          data: { ...tf, userId, date, checkIn: new Date() },
        });
      }
      writeAudit({
        tenantId: req.user.tenantId,
        actorId: req.user.sub,
        action: 'attendance.manual_checkin',
        entity: 'AttendanceRecord',
        entityId: record.id,
        newValue: { memberId: member.id, userId },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.json({
        checkedIn: true,
        member: { id: member.id, name: member.name },
        checkedInAt: record.checkIn,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  '/manual-check-out',
  requireRole(...STAFF_SCAN_ROLES),
  validateBody(manualSchema),
  async (req, res, next) => {
    try {
      const tf = tenantFilter(req);
      const member = await prisma.member.findFirst({
        where: { id: req.body.memberId, ...tf },
        select: { id: true, name: true, email: true },
      });
      if (!member) return res.status(404).json({ error: { message: 'Member not found.' } });
      const userId = await resolveMemberUserId(member, tf);
      if (!userId) {
        return res.status(400).json({
          error: { message: 'This member has no linked login account.' },
        });
      }
      const record = await prisma.attendanceRecord.findFirst({
        where: { ...tf, userId, date: todayDateOnly() },
      });
      if (!record || !record.checkIn) {
        return res.status(400).json({ error: { message: 'No check-in record found for today.' } });
      }
      if (record.checkOut) {
        return res.json({
          alreadyCheckedOut: true,
          member: { id: member.id, name: member.name },
          checkedOutAt: record.checkOut,
        });
      }
      const updated = await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: { checkOut: new Date() },
      });
      writeAudit({
        tenantId: req.user.tenantId,
        actorId: req.user.sub,
        action: 'attendance.manual_checkout',
        entity: 'AttendanceRecord',
        entityId: updated.id,
        newValue: { memberId: member.id, userId },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.json({
        checkedOut: true,
        member: { id: member.id, name: member.name },
        checkedOutAt: updated.checkOut,
      });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
