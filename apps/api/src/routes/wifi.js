// Phase 34 Track 7: WiFi Voucher Management.
// Mount (coordinator): app.use('/api/wifi', require('./routes/wifi'));
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { notify } = require('../lib/mailer');

const router = express.Router();
router.use(authenticate, requireTenantUser);

// Ambiguous chars (0/O, 1/I/l) excluded so codes are easy to read/type.
function genCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

async function uniqueCode(tx) {
  for (let i = 0; i < 10; i++) {
    const code = genCode();
    const exists = await tx.wifiVoucher.findUnique({ where: { code } });
    if (!exists) return code;
  }
  throw new Error('Could not generate a unique voucher code');
}

const generateSchema = z.object({
  count: z.number().int().min(1).max(100).default(1),
  durationHours: z.number().int().min(1).max(720).default(24),
  maxDevices: z.number().int().min(1).max(20).default(2),
  memberId: z.string().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

// POST /api/wifi/generate — batch voucher codes banao (staff)
router.post(
  '/generate',
  requireRole('ceo', 'admin', 'super_admin', 'manager', 'receptionist'),
  async (req, res, next) => {
    try {
      const body = generateSchema.parse(req.body || {});
      const { tenantId } = tenantFilter(req);

      let member = null;
      if (body.memberId) {
        member = await prisma.member.findFirst({
          where: { id: body.memberId, ...tenantFilter(req) },
          select: { id: true, name: true, email: true },
        });
        if (!member) return res.status(404).json({ error: 'Member not found' });
      }

      const vouchers = await prisma.$transaction(async (tx) => {
        const created = [];
        for (let i = 0; i < body.count; i++) {
          const code = await uniqueCode(tx);
          created.push(
            await tx.wifiVoucher.create({
              data: {
                tenantId,
                code,
                memberId: member ? member.id : null,
                durationHours: body.durationHours,
                maxDevices: body.maxDevices,
                expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
                status: 'active',
              },
            })
          );
        }
        return created;
      });

      writeAudit({
        tenantId,
        actorId: req.user.sub,
        action: 'wifi.vouchers_generated',
        entity: 'wifiVoucher',
        entityId: vouchers[0]?.id,
        newValue: { count: vouchers.length, memberId: member?.id || null },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      }).catch(() => {});

      // Member ko voucher assign hua to email me code bhejo
      if (member && member.email) {
        notify(tenantId, member.email, 'wifiVoucher', {
          memberName: member.name,
          code: vouchers.map((v) => v.code).join(', '),
          durationHours: String(body.durationHours),
          maxDevices: String(body.maxDevices),
        }).catch(() => {});
      }

      return res.status(201).json({ vouchers });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /api/wifi — vouchers list (staff)
router.get(
  '/',
  requireRole('ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'finance_officer'),
  async (req, res, next) => {
    try {
      const { status, memberId, search } = req.query;
      const where = { ...tenantFilter(req) };
      if (status) where.status = String(status);
      if (memberId) where.memberId = String(memberId);
      if (search) where.code = { contains: String(search).toUpperCase(), mode: 'insensitive' };
      const vouchers = await prisma.wifiVoucher.findMany({
        where,
        include: { member: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return res.json({ vouchers });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /api/wifi/:id/revoke — voucher revoke karo (staff)
router.post(
  '/:id/revoke',
  requireRole('ceo', 'admin', 'super_admin', 'manager'),
  async (req, res, next) => {
    try {
      const { tenantId } = tenantFilter(req);
      const voucher = await prisma.wifiVoucher.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
      const updated = await prisma.wifiVoucher.update({
        where: { id: voucher.id },
        data: { status: 'revoked' },
      });
      writeAudit({
        tenantId,
        actorId: req.user.sub,
        action: 'wifi.voucher_revoked',
        entity: 'wifiVoucher',
        entityId: voucher.id,
        oldValue: { status: voucher.status },
        newValue: { status: 'revoked' },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      }).catch(() => {});
      return res.json({ voucher: updated });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /api/wifi/validate — code validate (captive portal integration ke liye).
// Abhi auth required hai — coordinator note: captive portal ke liye isay
// rate-limited public endpoint banana hoga (tenant API key ya signed token se).
router.post('/validate', async (req, res, next) => {
  try {
    const schema = z.object({ code: z.string().min(4).max(16) });
    const { code } = schema.parse(req.body || {});
    const voucher = await prisma.wifiVoucher.findFirst({
      where: { code: code.toUpperCase().trim(), ...tenantFilter(req) },
      select: {
        id: true, code: true, status: true, durationHours: true,
        maxDevices: true, expiresAt: true, usedAt: true,
        member: { select: { id: true, name: true } },
      },
    });
    if (!voucher) return res.status(404).json({ valid: false, reason: 'not_found' });
    const now = new Date();
    let valid = voucher.status === 'active';
    let reason = valid ? null : voucher.status;
    if (valid && voucher.expiresAt && voucher.expiresAt < now) {
      valid = false;
      reason = 'expired';
      // Lazy expiry flip — agli dafa sahi status mile
      prisma.wifiVoucher
        .update({ where: { id: voucher.id }, data: { status: 'expired' } })
        .catch(() => {});
    }
    return res.json({ valid, reason, voucher: valid ? voucher : undefined });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
