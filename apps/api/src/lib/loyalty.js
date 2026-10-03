// Phase 33 Track 3: Loyalty Points — core ledger logic.
const prisma = require('./prisma');

async function getSettingNum(tenantId, key, def) {
  try {
    const row = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    const v = parseFloat(row && row.value);
    return Number.isFinite(v) && v >= 0 ? v : def;
  } catch {
    return def;
  }
}

// Award positive points. Throws on bad input; caller decides on DB failures.
async function awardPoints(tenantId, memberId, points, reason, relatedId) {
  const pts = Math.floor(Number(points));
  if (!Number.isFinite(pts) || pts <= 0) {
    const e = new Error('Points must be a positive integer');
    e.status = 400;
    throw e;
  }
  return prisma.loyaltyLedger.create({
    data: {
      tenantId,
      memberId,
      points: pts,
      reason: reason || 'manual_adjust',
      relatedId: relatedId || null,
    },
  });
}

// Current balance = sum of all ledger entries (earn - redeem).
async function getBalance(tenantId, memberId) {
  try {
    const agg = await prisma.loyaltyLedger.aggregate({
      where: { tenantId, memberId },
      _sum: { points: true },
    });
    return Number(agg._sum.points || 0);
  } catch (err) {
    // Table not migrated yet — treat as zero, never crash the caller.
    if (/loyalty/i.test(String((err && err.message) || err))) return 0;
    throw err;
  }
}

// Redeem points atomically: balance check + negative entry in one transaction.
async function redeemPoints(tenantId, memberId, points, relatedId) {
  const pts = Math.floor(Number(points));
  if (!Number.isFinite(pts) || pts <= 0) {
    const e = new Error('Points must be a positive integer');
    e.status = 400;
    throw e;
  }
  return prisma.$transaction(async (tx) => {
    const agg = await tx.loyaltyLedger.aggregate({
      where: { tenantId, memberId },
      _sum: { points: true },
    });
    const balance = Number(agg._sum.points || 0);
    if (balance < pts) {
      const e = new Error(`Insufficient points. Balance: ${balance}, requested: ${pts}`);
      e.status = 400;
      throw e;
    }
    return tx.loyaltyLedger.create({
      data: {
        tenantId,
        memberId,
        points: -pts,
        reason: 'redeemed',
        relatedId: relatedId || null,
      },
    });
  });
}

// Auto-earn: invoice fully paid -> floor(amount / 1000) * loyaltyRate points.
// loyaltyRate setting = points per Rs 1000 paid (default 10). Never throws —
// fire-and-forget safe for the payments flow.
async function awardForPayment(tenantId, memberId, amountPaid, invoiceId) {
  try {
    const rate = await getSettingNum(tenantId, 'loyaltyRate', 10);
    if (!(rate > 0)) return 0;
    const points = Math.floor(Number(amountPaid) / 1000) * rate;
    if (points <= 0) return 0;
    await awardPoints(tenantId, memberId, points, 'invoice_payment', invoiceId || null);
    return points;
  } catch (err) {
    console.error('[loyalty] awardForPayment failed:', err.message);
    return 0;
  }
}

// Referral reward: bonus points to the referrer.
// referralBonusPoints setting (default 100). Never throws.
async function awardReferralBonus(tenantId, referrerMemberId, referredMemberId) {
  try {
    const bonus = await getSettingNum(tenantId, 'referralBonusPoints', 100);
    if (!(bonus > 0)) return 0;
    await awardPoints(tenantId, referrerMemberId, Math.floor(bonus), 'referral_bonus', referredMemberId || null);
    return Math.floor(bonus);
  } catch (err) {
    console.error('[loyalty] awardReferralBonus failed:', err.message);
    return 0;
  }
}

module.exports = {
  getSettingNum,
  awardPoints,
  getBalance,
  redeemPoints,
  awardForPayment,
  awardReferralBonus,
};
