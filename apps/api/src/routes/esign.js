// Phase 36 Track 4: E-Signatures for contracts.
// Mount (coordinator): app.use('/api/esign', require('./routes/esign'));
// Staff request a signature via email; the signer opens a token link (public),
// draws/types a signature on a canvas; IP + timestamp + audit are recorded.
//
// Note: ContractStatus enum is active/expired/cancelled — the signature is a
// separate legal record on ContractSignature (status signed); the contract's
// own status is intentionally left untouched.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { notify } = require('../lib/mailer');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const WEB_URL = process.env.WEB_URL || 'https://techub-co-working.pages.dev';
const SIGN_LINK_DAYS = 14;
const MAX_SIGNATURE_CHARS = 1000000; // ~750KB decoded PNG — plenty for a canvas pad

const signLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests. Please try again later.',
});

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim().slice(0, 64);
  return (req.ip || '').slice(0, 64);
}

// Only real image data-URLs are accepted — no SVG (XSS risk) or text.
function validateSignatureImage(dataUrl) {
  if (typeof dataUrl !== 'string') return 'signatureDataUrl must be a string';
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!m) return 'signatureDataUrl must be a PNG or JPEG data URL';
  const b64 = m[2].replace(/\s+/g, '');
  if (b64.length > MAX_SIGNATURE_CHARS) return 'Signature image is too large (max ~750KB)';
  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return 'Invalid base64 in signatureDataUrl';
  }
  if (buf.length < 100) return 'Signature image is too small to be a real signature';
  // Magic bytes: PNG or JPEG
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!isPng && !isJpg) return 'Signature image is not a valid PNG/JPEG';
  return null;
}

async function findSignature(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  const tokenHash = hashToken(token);
  return prisma.contractSignature.findUnique({
    where: { tokenHash },
    include: {
      contract: {
        include: {
          member: { select: { id: true, name: true } },
          unit: { select: { id: true, code: true, type: true } },
        },
      },
    },
  });
}

function publicSummary(sig) {
  const c = sig.contract || {};
  return {
    id: sig.id,
    status: sig.status,
    signerName: sig.signerName,
    signerEmail: sig.signerEmail,
    signedAt: sig.signedAt,
    expiresAt: sig.expiresAt,
    declineReason: sig.declineReason,
    contract: {
      id: c.id,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      rentAmount: c.rentAmount != null ? String(c.rentAmount) : null,
      memberName: c.member ? c.member.name : null,
      unitCode: c.unit ? c.unit.code : null,
      unitType: c.unit ? c.unit.type : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Public signing endpoints (no auth — unguessable token, rate-limited).
// ---------------------------------------------------------------------------

// GET /sign/:token — contract summary + signature pad state
router.get('/sign/:token', signLimiter, async (req, res, next) => {
  try {
    const sig = await findSignature(req.params.token);
    if (!sig) return res.status(404).json({ error: { message: 'Signing link is invalid.' } });
    if (sig.status === 'pending' && sig.expiresAt && sig.expiresAt < new Date()) {
      await prisma.contractSignature
        .update({ where: { id: sig.id }, data: { status: 'expired', tokenHash: null } })
        .catch(() => {});
      return res.status(410).json({ error: { message: 'This signing link has expired.' } });
    }
    return res.json({ signature: publicSummary(sig) });
  } catch (err) {
    return next(err);
  }
});

const signSchema = z.object({
  signatureDataUrl: z.string().min(1),
  typedName: z.string().max(120).optional().nullable(),
});

// POST /sign/:token — submit signature
router.post('/sign/:token', signLimiter, validateBody(signSchema), async (req, res, next) => {
  try {
    const sig = await findSignature(req.params.token);
    if (!sig) return res.status(404).json({ error: { message: 'Signing link is invalid.' } });
    if (sig.status !== 'pending')
      return res.status(409).json({ error: { message: `This request is already ${sig.status}.` } });
    if (sig.expiresAt && sig.expiresAt < new Date()) {
      await prisma.contractSignature
        .update({ where: { id: sig.id }, data: { status: 'expired', tokenHash: null } })
        .catch(() => {});
      return res.status(410).json({ error: { message: 'This signing link has expired.' } });
    }

    const imgError = validateSignatureImage(req.body.signatureDataUrl);
    if (imgError) return res.status(400).json({ error: { message: imgError } });

    const now = new Date();
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 255);

    // One transaction: mark signed, consume token, expire sibling pending requests.
    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.contractSignature.update({
        where: { id: sig.id },
        data: {
          signatureImage: req.body.signatureDataUrl.trim(),
          status: 'signed',
          signedAt: now,
          ipAddress: ip,
          userAgent: ua,
          tokenHash: null, // single-use link
        },
      });
      await tx.contractSignature.updateMany({
        where: { contractId: sig.contractId, status: 'pending', id: { not: sig.id } },
        data: { status: 'expired', tokenHash: null },
      });
      return s;
    });

    writeAudit({
      tenantId: sig.tenantId,
      actorId: null,
      action: 'contract.signed',
      entity: 'ContractSignature',
      entityId: sig.id,
      newValue: {
        contractId: sig.contractId,
        signerName: sig.signerName,
        signerEmail: sig.signerEmail,
        signedAt: now.toISOString(),
        ipAddress: ip,
      },
      ip,
      userAgent: ua,
    }).catch(() => {});

    // Phase 50: save template-based signed doc to legal vault (fire-and-forget)
    try { require('../lib/templateSign').saveSignedDocumentToVault(updated.id).catch(() => {}); } catch {}

    return res.json({
      signature: { id: updated.id, status: updated.status, signedAt: updated.signedAt },
    });
  } catch (err) {
    return next(err);
  }
});

// POST /sign/:token/decline — signer declines
router.post(
  '/sign/:token/decline',
  signLimiter,
  validateBody(z.object({ reason: z.string().max(500).optional().nullable() })),
  async (req, res, next) => {
    try {
      const sig = await findSignature(req.params.token);
      if (!sig) return res.status(404).json({ error: { message: 'Signing link is invalid.' } });
      if (sig.status !== 'pending')
        return res.status(409).json({ error: { message: `This request is already ${sig.status}.` } });

      const updated = await prisma.contractSignature.update({
        where: { id: sig.id },
        data: {
          status: 'declined',
          declineReason: req.body.reason ? String(req.body.reason).slice(0, 500) : null,
          tokenHash: null,
        },
      });

      writeAudit({
        tenantId: sig.tenantId,
        actorId: null,
        action: 'contract.signature_declined',
        entity: 'ContractSignature',
        entityId: sig.id,
        newValue: { contractId: sig.contractId, reason: updated.declineReason },
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
      }).catch(() => {});

      return res.json({ signature: { id: updated.id, status: updated.status } });
    } catch (err) {
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Staff endpoints.
// ---------------------------------------------------------------------------
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'manager', 'finance_officer', 'operations_manager'];
const staffOnly = requireRole(...STAFF);

const requestSchema = z.object({
  signerName: z.string().min(1).max(120),
  signerEmail: z.string().email().max(160),
});

// POST /contracts/:id/request — staff requests a signature by email
router.post('/contracts/:id/request', staffOnly, validateBody(requestSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const contract = await prisma.contract.findFirst({
      where: { id: req.params.id, ...tf },
      include: {
        member: { select: { id: true, name: true, email: true } },
        unit: { select: { id: true, code: true } },
      },
    });
    if (!contract) return res.status(404).json({ error: { message: 'Contract not found' } });

    const { signerName, signerEmail } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SIGN_LINK_DAYS * 24 * 60 * 60 * 1000);

    // Invalidate older pending requests for this contract (single active link).
    await prisma.contractSignature
      .updateMany({
        where: { contractId: contract.id, status: 'pending' },
        data: { status: 'expired', tokenHash: null },
      })
      .catch(() => {});

    const sig = await prisma.contractSignature.create({
      data: {
        tenantId: req.tenantId,
        contractId: contract.id,
        signerName: signerName.trim(),
        signerEmail: signerEmail.trim().toLowerCase(),
        tokenHash: hashToken(token),
        status: 'pending',
        expiresAt,
      },
    });

    const signUrl = `${WEB_URL}/sign/${token}`;
    notify(req.tenantId, signerEmail, 'contractSignatureRequest', {
      signerName: signerName.trim(),
      memberName: contract.member ? contract.member.name : '',
      unitCode: contract.unit ? contract.unit.code : '',
      signUrl,
      expiresAt: expiresAt.toLocaleDateString(),
    }).catch(() => {});

    writeAudit({
      tenantId: req.tenantId,
      actorId: req.user.sub,
      action: 'contract.signature_requested',
      entity: 'ContractSignature',
      entityId: sig.id,
      newValue: { contractId: contract.id, signerName, signerEmail },
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
    }).catch(() => {});

    return res.status(201).json({
      signature: { id: sig.id, status: sig.status, expiresAt: sig.expiresAt },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /contracts/:id/signatures — signature history for a contract (staff)
router.get('/contracts/:id/signatures', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const contract = await prisma.contract.findFirst({ where: { id: req.params.id, ...tf } });
    if (!contract) return res.status(404).json({ error: { message: 'Contract not found' } });
    const signatures = await prisma.contractSignature.findMany({
      where: { contractId: contract.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        signerName: true,
        signerEmail: true,
        status: true,
        signedAt: true,
        ipAddress: true,
        expiresAt: true,
        declineReason: true,
        createdAt: true,
      },
    });
    return res.json({ signatures });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
