// Phase 48 Track 5: Visitor day passes.
// Mount (coordinator): app.use('/api/day-passes', require('./routes/day-passes'));
// Reception visitor ko time-bound day pass deti hai (QR token + WhatsApp share).
// Statuses: active | used | expired | revoked
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { signDayPassQr, verifyDayPassQr } = require('../lib/dayPassQr');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const PASS_ROLES = ['receptionist', 'ops', 'operations_manager', 'manager', 'admin', 'ceo', 'super_admin'];
const passStaff = requireRole(...PASS_ROLES);

// 503 guard — fragment merge/migration se pehle endpoints safe fail hon.
function modelReady() {
  return prisma && typeof prisma.dayPass?.findFirst === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'day-passes migration pending' });
  next();
}
router.use(guard);

const createSchema = z.object({
  visitorName: z.string().min(1).max(120),
  visitorPhone: z.string().max(30).optional().nullable(),
  hostMemberId: z.string().optional().nullable(),
  validFrom: z.string().optional().nullable(), // ISO datetime; default: now
  validUntil: z.string().optional().nullable(), // ISO datetime; default: today 23:59
  doorIds: z.array(z.string()).optional().nullable(), // null/empty = all doors
});

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

async function generateCode(tenantId) {
  for (let i = 0; i < 10; i++) {
    const code = Array.from(crypto.randomBytes(6))
      .map((b) => CODE_CHARS[b % CODE_CHARS.length])
      .join('');
    const clash = await prisma.dayPass.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!clash) return code;
  }
  throw new Error('Could not generate unique day-pass code');
}

// Best-effort: guzre hue active passes ko expired mark karo.
async function expireStale(tenantId) {
  try {
    await prisma.dayPass.updateMany({
      where: { tenantId, status: 'active', validUntil: { lt: new Date() } },
      data: { status: 'expired' },
    });
  } catch {
    /* non-fatal */
  }
}

function publicPass(pass) {
  return {
    id: pass.id,
    code: pass.code,
    visitorName: pass.visitorName,
    visitorPhone: pass.visitorPhone,
    hostMember: pass.hostMember ? { id: pass.hostMember.id, name: pass.hostMember.name } : null,
    validFrom: pass.validFrom,
    validUntil: pass.validUntil,
    doorIds: pass.doorIds,
    status: pass.status,
    usedAt: pass.usedAt,
    createdAt: pass.createdAt,
  };
}

function passSummary(pass, qrToken) {
  const from = new Date(pass.validFrom).toLocaleString();
  const until = new Date(pass.validUntil).toLocaleString();
  return {
    ...publicPass(pass),
    qrToken,
    whatsappShare: `https://wa.me/?text=${encodeURIComponent(
      `Visitor Day Pass — ${pass.visitorName}\nCode: ${pass.code}\nValid: ${from} → ${until}\nShow this QR at reception.`
    )}`,
  };
}

const includePass = {
  hostMember: { select: { id: true, name: true } },
};

// POST / — day pass issue karo
router.post('/', passStaff, validateBody(createSchema), async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const now = new Date();
    const validFrom = req.body.validFrom ? new Date(req.body.validFrom) : now;
    let validUntil;
    if (req.body.validUntil) {
      validUntil = new Date(req.body.validUntil);
    } else {
      validUntil = new Date(validFrom);
      validUntil.setHours(23, 59, 59, 999); // default: same day end
    }
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
      return res.status(422).json({ error: 'validFrom/validUntil must be valid datetimes' });
    }
    if (validUntil <= validFrom) {
      return res.status(422).json({ error: 'validUntil must be after validFrom' });
    }
    if (req.body.hostMemberId) {
      const host = await prisma.member.findFirst({
        where: { ...tenantFilter(req), id: req.body.hostMemberId },
        select: { id: true },
      });
      if (!host) return res.status(422).json({ error: 'hostMemberId not found in this tenant' });
    }
    await expireStale(tenantId);
    const code = await generateCode(tenantId);
    const pass = await prisma.dayPass.create({
      data: {
        tenantId,
        visitorName: req.body.visitorName.trim(),
        visitorPhone: req.body.visitorPhone || null,
        hostMemberId: req.body.hostMemberId || null,
        code,
        validFrom,
        validUntil,
        doorIds: req.body.doorIds && req.body.doorIds.length ? req.body.doorIds : null,
        status: 'active',
        createdById: req.user?.id || null,
      },
      include: includePass,
    });
    const qrToken = signDayPassQr({ tenantId, passId: pass.id, validUntil: pass.validUntil });
    writeAudit(req, 'day_pass.created', { passId: pass.id, code }).catch(() => {});
    return res.status(201).json(passSummary(pass, qrToken));
  } catch (e) {
    next(e);
  }
});

// GET / — passes list (?status=, ?q= name/code search)
router.get('/', passStaff, async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    await expireStale(tenantId);
    const where = { ...tenantFilter(req) };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.q) {
      where.OR = [
        { visitorName: { contains: String(req.query.q), mode: 'insensitive' } },
        { code: { contains: String(req.query.q).toUpperCase(), mode: 'insensitive' } },
      ];
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const [total, passes] = await Promise.all([
      prisma.dayPass.count({ where }),
      prisma.dayPass.findMany({
        where,
        include: includePass,
        orderBy: { validFrom: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return res.json({ total, page, limit, passes: passes.map(publicPass) });
  } catch (e) {
    next(e);
  }
});

// GET /:id — pass detail (+ fresh QR token)
router.get('/:id', passStaff, async (req, res, next) => {
  try {
    const pass = await prisma.dayPass.findFirst({
      where: { ...tenantFilter(req), id: req.params.id },
      include: includePass,
    });
    if (!pass) return res.status(404).json({ error: 'Day pass not found' });
    const qrToken = signDayPassQr({ tenantId: req.tenantId, passId: pass.id, validUntil: pass.validUntil });
    return res.json(passSummary(pass, qrToken));
  } catch (e) {
    next(e);
  }
});

// POST /:id/revoke — pass revoke karo
router.post('/:id/revoke', passStaff, async (req, res, next) => {
  try {
    const pass = await prisma.dayPass.findFirst({
      where: { ...tenantFilter(req), id: req.params.id },
    });
    if (!pass) return res.status(404).json({ error: 'Day pass not found' });
    if (pass.status === 'revoked') return res.json(publicPass(pass));
    const updated = await prisma.dayPass.update({
      where: { id: pass.id },
      data: { status: 'revoked' },
      include: includePass,
    });
    writeAudit(req, 'day_pass.revoked', { passId: pass.id, code: pass.code }).catch(() => {});
    return res.json(publicPass(updated));
  } catch (e) {
    next(e);
  }
});

// POST /validate — scan flow: { code } ya { token }
// code = 6-char short code; token = signed QR token.
router.post('/validate', passStaff, async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    await expireStale(tenantId);
    let passId = null;
    if (req.body.token) {
      const v = verifyDayPassQr(String(req.body.token));
      if (!v.ok) {
        return res.status(400).json({ ok: false, reason: v.reason, message: qrMessage(v.reason) });
      }
      if (v.payload.tenantId !== tenantId) {
        return res.status(422).json({ ok: false, reason: 'wrong-tenant', message: 'Pass belongs to another tenant.' });
      }
      passId = v.payload.passId;
    }
    const where = { ...tenantFilter(req) };
    if (passId) where.id = passId;
    else if (req.body.code) where.code = String(req.body.code).toUpperCase();
    else return res.status(400).json({ ok: false, reason: 'missing', message: 'code or token is required.' });
    const pass = await prisma.dayPass.findFirst({ where, include: includePass });
    if (!pass) return res.status(404).json({ ok: false, reason: 'not-found', message: 'Day pass not found.' });
    const now = new Date();
    if (pass.status === 'revoked') {
      return res.status(410).json({ ok: false, reason: 'revoked', message: 'This pass has been revoked.', pass: publicPass(pass) });
    }
    if (pass.status === 'used') {
      return res.status(409).json({ ok: false, reason: 'already-used', message: 'This pass was already used.', pass: publicPass(pass) });
    }
    if (pass.status === 'expired' || now > new Date(pass.validUntil)) {
      return res.status(410).json({ ok: false, reason: 'expired', message: 'This pass has expired.', pass: publicPass(pass) });
    }
    if (now < new Date(pass.validFrom)) {
      return res.status(422).json({ ok: false, reason: 'not-yet-valid', message: 'This pass is not valid yet.', pass: publicPass(pass) });
    }
    // Optional door scope check
    const doorId = req.body.doorId;
    if (doorId && Array.isArray(pass.doorIds) && pass.doorIds.length && !pass.doorIds.includes(doorId)) {
      return res.status(422).json({ ok: false, reason: 'door-not-allowed', message: 'This pass is not valid for this door.', pass: publicPass(pass) });
    }
    return res.json({ ok: true, reason: 'valid', message: 'Entry allowed.', pass: publicPass(pass) });
  } catch (e) {
    next(e);
  }
});

// POST /:id/use — entry record karo (pass ko used mark)
router.post('/:id/use', passStaff, async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    await expireStale(tenantId);
    const pass = await prisma.dayPass.findFirst({
      where: { ...tenantFilter(req), id: req.params.id },
    });
    if (!pass) return res.status(404).json({ error: 'Day pass not found' });
    if (pass.status !== 'active') {
      return res.status(422).json({ error: `Cannot use a ${pass.status} pass.` });
    }
    const updated = await prisma.dayPass.update({
      where: { id: pass.id },
      data: { status: 'used', usedAt: new Date() },
      include: includePass,
    });
    writeAudit(req, 'day_pass.used', { passId: pass.id, code: pass.code }).catch(() => {});
    return res.json(publicPass(updated));
  } catch (e) {
    next(e);
  }
});

function qrMessage(reason) {
  switch (reason) {
    case 'expired': return 'Day-pass QR has expired.';
    case 'bad-signature': return 'Invalid day pass (signature mismatch).';
    case 'malformed':
    case 'missing': return 'Invalid day-pass code format.';
    default: return 'Invalid day pass.';
  }
}

module.exports = router;
