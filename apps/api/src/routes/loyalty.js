// Phase 33 Track 3: Loyalty Points API.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const {
  getSettingNum,
  awardPoints,
  getBalance,
  redeemPoints,
  awardReferralBonus,
} = require('../lib/loyalty');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'finance_officer', 'manager', 'super_admin'];

// Resolve which member's loyalty data is being accessed: staff may pass
// ?memberId=, members can only ever see their own.
function resolveMemberId(req) {
  if (req.user.role === 'member') {
    if (!req.user.memberId) {
      const e = new Error('No member linked to this account');
      e.status = 400;
      throw e;
    }
    return req.user.memberId;
  }
  const id = req.query.memberId || req.body.memberId;
  if (!id) {
    const e = new Error('memberId is required');
    e.status = 400;
    throw e;
  }
  return String(id);
}

async function nextCnNumber(tenantId) {
  const now = new Date();
  const prefix = `CN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const last = await prisma.creditNote.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const seq = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// Balance — member apna, staff ?memberId=
router.get('/balance', async (req, res, next) => {
  try {
    const memberId = resolveMemberId(req);
    const balance = await getBalance(req.user.tenantId, memberId);
    const [pointValue, loyaltyRate, referralBonusPoints] = await Promise.all([
      getSettingNum(req.user.tenantId, 'pointValue', 1),
      getSettingNum(req.user.tenantId, 'loyaltyRate', 10),
      getSettingNum(req.user.tenantId, 'referralBonusPoints', 100),
    ]);
    res.json({ memberId, balance, pointValue, loyaltyRate, referralBonusPoints });
  } catch (e) { next(e); }
});

// History — member apni, staff ?memberId=
router.get('/history', async (req, res, next) => {
  try {
    const memberId = resolveMemberId(req);
    const [entries, balance] = await Promise.all([
      prisma.loyaltyLedger.findMany({
        where: { ...tenantFilter(req), memberId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      getBalance(req.user.tenantId, memberId),
    ]);
    res.json({ memberId, balance, entries });
  } catch (e) { next(e); }
});

const redeemSchema = z.object({ points: z.number().int().positive() });

// Redeem points -> discount credit note (pointValue Rs per point).
router.post('/redeem', validateBody(redeemSchema), async (req, res, next) => {
  try {
    if (req.user.role !== 'member' || !req.user.memberId) {
      return res.status(403).json({ error: { message: 'Only members can redeem points.' } });
    }
    const memberId = req.user.memberId;
    const points = Math.floor(req.body.points);
    const pointValue = await getSettingNum(req.user.tenantId, 'pointValue', 1);
    const amount = points * pointValue;

    const member = await prisma.member.findFirst({
      where: { id: memberId, ...tenantFilter(req) },
      select: { id: true, name: true },
    });
    if (!member) return res.status(404).json({ error: { message: 'Member not found.' } });

    // 1) create the credit note first
    const cn = await prisma.creditNote.create({
      data: {
        tenantId: req.user.tenantId,
        number: await nextCnNumber(req.user.tenantId),
        memberId,
        amount,
        reason: `Loyalty redemption: ${points} pts`,
        createdById: req.user.sub,
      },
    });
    // 2) debit the ledger (atomic balance check inside); compensate on failure
    try {
      await redeemPoints(req.user.tenantId, memberId, points, cn.id);
    } catch (err) {
      await prisma.creditNote.delete({ where: { id: cn.id } }).catch(() => {});
      throw err;
    }

    writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'loyalty.redeemed',
      entity: 'LoyaltyLedger',
      entityId: cn.id,
      newValue: { memberId, points, amount },
    }).catch(() => {});
    res.status(201).json({
      creditNote: cn,
      pointsRedeemed: points,
      amount,
      balance: await getBalance(req.user.tenantId, memberId),
    });
  } catch (e) { next(e); }
});

// Staff: kisi member ka ledger + balance
router.get('/members/:id', requireRole(...STAFF), async (req, res, next) => {
  try {
    const memberId = req.params.id;
    const member = await prisma.member.findFirst({
      where: { id: memberId, ...tenantFilter(req) },
      select: { id: true, name: true, email: true },
    });
    if (!member) return res.status(404).json({ error: { message: 'Member not found.' } });
    const [entries, balance] = await Promise.all([
      prisma.loyaltyLedger.findMany({
        where: { ...tenantFilter(req), memberId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      getBalance(req.user.tenantId, memberId),
    ]);
    res.json({ member, balance, entries });
  } catch (e) { next(e); }
});

// Staff: manual adjust (positive = award, negative = deduct)
router.post(
  '/members/:id/adjust',
  requireRole(...STAFF),
  validateBody(z.object({ points: z.number().int(), reason: z.string().min(1).max(200) })),
  async (req, res, next) => {
    try {
      const memberId = req.params.id;
      const member = await prisma.member.findFirst({
        where: { id: memberId, ...tenantFilter(req) },
        select: { id: true },
      });
      if (!member) return res.status(404).json({ error: { message: 'Member not found.' } });
      const pts = Math.floor(req.body.points);
      if (pts === 0) return res.status(400).json({ error: { message: 'Points cannot be zero.' } });
      let entry;
      if (pts > 0) {
        entry = await awardPoints(req.user.tenantId, memberId, pts, req.body.reason, null);
      } else {
        entry = await redeemPoints(req.user.tenantId, memberId, -pts, null);
        entry = await prisma.loyaltyLedger.update({
          where: { id: entry.id },
          data: { reason: req.body.reason },
        });
      }
      writeAudit({
        tenantId: req.user.tenantId,
        actorId: req.user.sub,
        action: 'loyalty.adjusted',
        entity: 'LoyaltyLedger',
        entityId: entry.id,
        newValue: { memberId, points: pts, reason: req.body.reason },
      }).catch(() => {});
      res.status(201).json({ entry, balance: await getBalance(req.user.tenantId, memberId) });
    } catch (e) { next(e); }
  }
);

// Staff: referral bonus award
router.post(
  '/referral-bonus',
  requireRole(...STAFF),
  validateBody(z.object({
    memberId: z.string().min(1),
    referredMemberId: z.string().min(1).optional().nullable(),
  })),
  async (req, res, next) => {
    try {
      const referrer = await prisma.member.findFirst({
        where: { id: req.body.memberId, ...tenantFilter(req) },
        select: { id: true, name: true },
      });
      if (!referrer) return res.status(404).json({ error: { message: 'Referrer member not found.' } });
      const awarded = await awardReferralBonus(
        req.user.tenantId,
        req.body.memberId,
        req.body.referredMemberId || null
      );
      writeAudit({
        tenantId: req.user.tenantId,
        actorId: req.user.sub,
        action: 'loyalty.referral_bonus',
        entity: 'LoyaltyLedger',
        newValue: { memberId: req.body.memberId, awarded, referredMemberId: req.body.referredMemberId || null },
      }).catch(() => {});
      res.status(201).json({
        awarded,
        balance: await getBalance(req.user.tenantId, req.body.memberId),
      });
    } catch (e) { next(e); }
  }
);

module.exports = router;
