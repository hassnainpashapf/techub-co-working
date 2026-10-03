// Phase 33 Track 2/10: Referral Program — member referral codes, invites, rewards.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { notify } = require('../lib/mailer');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const WEB_URL = process.env.WEB_URL || 'https://techub-co-working.pages.dev';
const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'finance_officer'];

// Resolve the member record for the logged-in user (memberId from JWT, email fallback).
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

function randomCode() {
  return 'REF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function getRewardAmount(tenantId) {
  try {
    const row = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: 'referralRewardAmount' } },
    });
    const v = parseFloat(row && row.value);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
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

// ---------- Member endpoints ----------

// GET /api/referrals/my-code — member ka referral code (auto-create agar nahi)
router.get('/my-code', requireRole('member'), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });

    let code = await prisma.referralCode.findFirst({
      where: { tenantId: tf.tenantId, memberId: member.id },
    });
    if (!code) {
      // Collision-proof insert (retry on unique clash).
      for (let i = 0; i < 5; i++) {
        try {
          code = await prisma.referralCode.create({
            data: { tenantId: tf.tenantId, memberId: member.id, code: randomCode() },
          });
          break;
        } catch (e) {
          if (e.code !== 'P2002' || i === 4) throw e;
        }
      }
      await writeAudit({
        tenantId: tf.tenantId, actorId: req.user.sub, action: 'referral.code.create',
        entity: 'ReferralCode', entityId: code.id,
        ip: req.ip, userAgent: req.headers['user-agent'],
      }).catch(() => {});
    }

    return res.json({
      code: code.code,
      joinUrl: `${WEB_URL}/join?ref=${encodeURIComponent(code.code)}`,
      rewardAmount: await getRewardAmount(tf.tenantId),
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/referrals/invite — dost ko invite email bhejo
router.post('/invite', requireRole('member'), validateBody(z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
})), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });

    const email = req.body.email.trim().toLowerCase();
    const dup = await prisma.referral.findFirst({
      where: { ...tf, referredEmail: email },
    });
    if (dup) return res.status(409).json({ error: { message: 'This email was already invited.' } });

    let code = await prisma.referralCode.findFirst({
      where: { tenantId: tf.tenantId, memberId: member.id },
    });
    if (!code) {
      code = await prisma.referralCode.create({
        data: { tenantId: tf.tenantId, memberId: member.id, code: randomCode() },
      });
    }

    const referral = await prisma.referral.create({
      data: {
        tenantId: tf.tenantId,
        codeId: code.id,
        referredName: req.body.name.trim(),
        referredEmail: email,
        status: 'invited',
      },
    });

    const rewardAmount = await getRewardAmount(tf.tenantId);
    notify(tf.tenantId, email, 'referralInvite', {
      name: req.body.name.trim(),
      referrerName: member.name,
      joinUrl: `${WEB_URL}/join?ref=${encodeURIComponent(code.code)}`,
      rewardNote: rewardAmount > 0 ? `Join now and you'll help ${member.name} earn Rs ${Number(rewardAmount).toLocaleString()} in credits.` : '',
    }).catch(() => {});

    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'referral.invite',
      entity: 'Referral', entityId: referral.id, newValue: { email },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.status(201).json({ referral });
  } catch (err) {
    return next(err);
  }
});

// GET /api/referrals/my-referrals — meri bheji hui invites
router.get('/my-referrals', requireRole('member'), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const member = await myMember(req);
    if (!member) return res.status(404).json({ error: { message: 'Member record not found.' } });

    const code = await prisma.referralCode.findFirst({
      where: { tenantId: tf.tenantId, memberId: member.id },
      include: {
        referrals: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, referredName: true, referredEmail: true, status: true, rewardAmount: true, createdAt: true },
        },
      },
    });
    return res.json({ referrals: code ? code.referrals : [] });
  } catch (err) {
    return next(err);
  }
});

// ---------- Staff endpoints ----------

// GET /api/referrals — sab referrals + stats
router.get('/', requireRole(...STAFF), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { status } = req.query;
    const where = { ...tf };
    if (status) where.status = status;

    const [referrals, stats, rewardAmount] = await Promise.all([
      prisma.referral.findMany({
        where,
        include: {
          code: {
            select: {
              code: true,
              member: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.referral.groupBy({
        by: ['status'],
        where: { ...tf },
        _count: { _all: true },
      }),
      getRewardAmount(tf.tenantId),
    ]);

    const counts = { invited: 0, joined: 0, rewarded: 0 };
    for (const s of stats) counts[s.status] = s._count._all;

    return res.json({ referrals, counts, rewardAmount });
  } catch (err) {
    return next(err);
  }
});

// POST /api/referrals/:id/mark-joined — referred banda member ban gaya
router.post('/:id/mark-joined', requireRole(...STAFF), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const referral = await prisma.referral.findFirst({ where: { id: req.params.id, ...tf } });
    if (!referral) return res.status(404).json({ error: { message: 'Referral not found.' } });
    if (referral.status !== 'invited') {
      return res.status(400).json({ error: { message: `Referral is already ${referral.status}.` } });
    }

    const updated = await prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'joined' },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'referral.mark_joined',
      entity: 'Referral', entityId: referral.id,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ referral: updated });
  } catch (err) {
    return next(err);
  }
});

// POST /api/referrals/:id/mark-rewarded — referrer ko credit note do
router.post('/:id/mark-rewarded', requireRole(...STAFF), validateBody(z.object({
  rewardAmount: z.number().positive().optional(),
})), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const referral = await prisma.referral.findFirst({
      where: { id: req.params.id, ...tf },
      include: { code: { include: { member: true } } },
    });
    if (!referral) return res.status(404).json({ error: { message: 'Referral not found.' } });
    if (referral.status === 'rewarded') {
      return res.status(400).json({ error: { message: 'Referral already rewarded.' } });
    }

    const amount = req.body.rewardAmount ?? await getRewardAmount(tf.tenantId);
    if (!(amount > 0)) {
      return res.status(400).json({ error: { message: 'Set a reward amount first (Referral settings).' } });
    }

    const cn = await prisma.creditNote.create({
      data: {
        tenantId: tf.tenantId,
        number: await nextCnNumber(tf.tenantId),
        memberId: referral.code.memberId,
        amount,
        reason: `Referral reward — ${referral.referredName} (${referral.referredEmail})`,
        createdById: req.user.sub,
      },
    });

    const updated = await prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'rewarded', rewardAmount: amount },
    });

    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'referral.reward',
      entity: 'Referral', entityId: referral.id,
      newValue: { amount, creditNote: cn.number },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.json({ referral: updated, creditNote: cn });
  } catch (err) {
    return next(err);
  }
});

// GET/PUT /api/referrals/settings — reward amount setting
router.get('/settings', requireRole('ceo', 'admin', 'super_admin'), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    return res.json({ referralRewardAmount: await getRewardAmount(tf.tenantId) });
  } catch (err) {
    return next(err);
  }
});

router.put('/settings', requireRole('ceo', 'admin', 'super_admin'), validateBody(z.object({
  referralRewardAmount: z.number().nonnegative(),
})), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId: tf.tenantId, key: 'referralRewardAmount' } },
      create: { tenantId: tf.tenantId, key: 'referralRewardAmount', value: String(req.body.referralRewardAmount) },
      update: { value: String(req.body.referralRewardAmount) },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'referral.settings.update',
      entity: 'Setting', entityId: 'referralRewardAmount',
      newValue: { referralRewardAmount: req.body.referralRewardAmount },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ referralRewardAmount: req.body.referralRewardAmount });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
