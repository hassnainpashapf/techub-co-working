// Phase 1: Extended auth — password reset, 2FA (TOTP), session management.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { authenticator } = require('otplib');

const prisma = require('../lib/prisma');
const { hashPassword, comparePassword } = require('../lib/auth');
const { encryptSecret } = require('../lib/crypto');
const { resolveTotpSecret, maybeMigrateTotpSecret } = require('../lib/totp');
const { authenticate } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { strictLimiter } = require('../middleware/rateLimit');
// Phase 32: dedicated 5/hour per email+IP limiter for password-reset endpoints
const { resetPasswordLimiter } = require('../lib/resetRateLimit');

const router = express.Router();

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
const forgotSchema = z.object({ email: z.string().email() });

router.post('/forgot-password', resetPasswordLimiter, validateBody(forgotSchema), async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    // Always return success to prevent email enumeration
    if (user && user.isActive) {
      // Invalidate previous unused tokens — only one live reset token per user
      await prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });
      const resetUrl = `${WEB_URL}/reset-password?token=${token}`;
      // Phase 32: real email via queued mailer (Phase 12/28) — never log the
      // plaintext token in production; the DB only ever holds the hash.
      const { notify } = require('../lib/mailer');
      await notify(user.tenantId, user.email, 'passwordReset', { name: user.name, resetUrl }).catch(() => {});
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[auth] password reset link for ${email}: ${resetUrl}`);
      }
      await writeAudit({
        tenantId: user.tenantId,
        actorId: user.id,
        action: 'auth.password_reset_requested',
        entity: 'User',
        entityId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return res.json({ message: 'If the email exists, a reset link has been sent.' });
  } catch (err) {
    return next(err);
  }
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

router.post('/reset-password', resetPasswordLimiter, validateBody(resetSchema), async (req, res, next) => {
  try {
    const { token, password } = req.body;
    // Phase 28: password policy
    const { validatePassword } = require('../lib/password');
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: { message: pwCheck.errors.join(' ') } });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // Phase 32: atomic single-use claim inside one transaction — concurrent
    // requests racing on the same token: only the first updateMany wins.
    const reset = await prisma.$transaction(async (tx) => {
      const rec = await tx.passwordReset.findFirst({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        include: { user: true },
      });
      if (!rec) return null;
      const claimed = await tx.passwordReset.updateMany({
        where: { id: rec.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return null; // lost the race — already used
      const passwordHash = await hashPassword(password);
      await tx.user.update({ where: { id: rec.userId }, data: { passwordHash } });
      // Revoke all sessions on password change
      await tx.session.updateMany({
        where: { userId: rec.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return rec;
    });
    if (!reset) {
      return res.status(400).json({ error: { message: 'Invalid or expired reset token.' } });
    }
    await writeAudit({
      tenantId: reset.user.tenantId,
      actorId: reset.userId,
      action: 'auth.password_reset_completed',
      entity: 'User',
      entityId: reset.userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------
const WEB_URL = process.env.WEB_URL || 'https://techub-co-working.pages.dev';

async function createVerificationToken(userId) {
  // Invalidate old unused tokens
  await prisma.emailVerification.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await prisma.emailVerification.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    },
  });
  return token;
}

// Send verification email (authenticated user)
router.post('/send-verification', authenticate, strictLimiter, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: { message: 'User not found.' } });
    if (user.emailVerifiedAt) return res.json({ message: 'Email already verified.' });
    const token = await createVerificationToken(user.id);
    const verifyUrl = `${WEB_URL}/verify-email?token=${token}`;
    const { notify } = require('../lib/mailer');
    await notify(user.tenantId, user.email, 'emailVerification', { name: user.name, verifyUrl }).catch(() => {});
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[auth] email verification for ${user.email}: ${verifyUrl}`);
    }
    return res.json({ message: 'Verification email sent.' });
  } catch (err) {
    return next(err);
  }
});

// Resend verification (public, by email — no enumeration)
router.post('/resend-verification', strictLimiter, validateBody(forgotSchema), async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive && !user.emailVerifiedAt) {
      const token = await createVerificationToken(user.id);
      const verifyUrl = `${WEB_URL}/verify-email?token=${token}`;
      const { notify } = require('../lib/mailer');
      await notify(user.tenantId, user.email, 'emailVerification', { name: user.name, verifyUrl }).catch(() => {});
    }
    return res.json({ message: 'If the email exists and is unverified, a verification link has been sent.' });
  } catch (err) {
    return next(err);
  }
});

// Verify email (public)
router.get('/verify-email', strictLimiter, async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: { message: 'Verification token is required.' } });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await prisma.emailVerification.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!record) {
      return res.status(400).json({ error: { message: 'Invalid or expired verification link.' } });
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailVerification.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    await writeAudit({
      tenantId: record.user.tenantId,
      actorId: record.userId,
      action: 'auth.email_verified',
      entity: 'User',
      entityId: record.userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// 2FA (TOTP)
// ---------------------------------------------------------------------------
router.post('/2fa/setup', authenticate, async (req, res, next) => {
  try {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(req.user.email || 'user', 'CoworkOS', secret);
    // Store encrypted at rest (not enabled until verified). The plaintext
    // `secret` + `otpauth` are still returned so the QR flow keeps working.
    await prisma.user.update({
      where: { id: req.user.sub },
      data: { totpSecret: encryptSecret(secret), totpEnabled: false },
    });
    return res.json({ secret, otpauth, message: 'Scan the QR code with your authenticator app, then verify.' });
  } catch (err) {
    return next(err);
  }
});

const verify2faSchema = z.object({ code: z.string().min(6).max(8) });

router.post('/2fa/verify', authenticate, validateBody(verify2faSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user || !user.totpSecret) {
      return res.status(400).json({ error: { message: '2FA not set up.' } });
    }
    const { secret } = resolveTotpSecret(user.totpSecret); // decrypts, or legacy plaintext
    const ok = authenticator.verify({ token: req.body.code, secret });
    if (!ok) {
      return res.status(400).json({ error: { message: 'Invalid verification code.' } });
    }
    // Auto-migrate legacy plaintext secret to encrypted on successful verify.
    await maybeMigrateTotpSecret(user.id, user.totpSecret);
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    await writeAudit({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.2fa_enabled',
      entity: 'User',
      entityId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ message: '2FA enabled successfully.' });
  } catch (err) {
    return next(err);
  }
});

router.post('/2fa/disable', authenticate, validateBody(verify2faSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user || !user.totpSecret) {
      return res.status(400).json({ error: { message: '2FA not set up.' } });
    }
    const { secret } = resolveTotpSecret(user.totpSecret); // decrypts, or legacy plaintext
    const ok = authenticator.verify({ token: req.body.code, secret });
    if (!ok) {
      return res.status(400).json({ error: { message: 'Invalid verification code.' } });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabled: false },
    });
    await writeAudit({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.2fa_disabled',
      entity: 'User',
      entityId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ message: '2FA disabled.' });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Sessions (device management)
// ---------------------------------------------------------------------------
router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, deviceInfo: true, ip: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ sessions });
  } catch (err) {
    return next(err);
  }
});

router.delete('/sessions/:id', authenticate, async (req, res, next) => {
  try {
    const session = await prisma.session.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!session) {
      return res.status(404).json({ error: { message: 'Session not found.' } });
    }
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return res.json({ message: 'Session revoked.' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
