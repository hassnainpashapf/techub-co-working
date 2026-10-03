const express = require('express');
const { z } = require('zod');
const { authenticator } = require('otplib');

const prisma = require('../lib/prisma');
const {
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  signPreAuthToken,
  verifyPreAuthToken,
} = require('../lib/auth');
const { authenticate } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimit');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function safeUser(user) {
  if (!user) return null;
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

function issuePair(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }
    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }
    // 2FA check — if enabled, require TOTP code before issuing tokens
    if (user.totpEnabled && user.totpSecret) {
      // Issue a short-lived pre-2FA token (5 min) to authorize the 2FA verify step
      const preToken = signPreAuthToken(user);
      return res.json({
        requires2fa: true,
        preToken,
        user: { id: user.id, name: user.name, email: user.email },
      });
    }
    const tokens = issuePair(user);
    await writeAudit({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        memberId: user.memberId,
        tenant: user.tenant ? user.tenant.name : null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Verify 2FA code after password login (uses pre-2FA token)
const verify2faLoginSchema = z.object({
  preToken: z.string().min(1),
  code: z.string().min(6).max(8),
});

router.post('/login/2fa', loginLimiter, validateBody(verify2faLoginSchema), async (req, res, next) => {
  try {
    const { preToken, code } = req.body;
    let payload;
    try {
      payload = verifyPreAuthToken(preToken);
    } catch (_e) {
      return res.status(401).json({ error: { message: 'Invalid or expired pre-auth token.' } });
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
      return res.status(401).json({ error: { message: 'Invalid request.' } });
    }
    const ok = authenticator.verify({ token: code, secret: user.totpSecret });
    if (!ok) {
      return res.status(401).json({ error: { message: 'Invalid 2FA code.' } });
    }
    const tokens = issuePair(user);
    await writeAudit({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        memberId: user.memberId,
        tenant: user.tenant ? user.tenant.name : null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/refresh', validateBody(refreshSchema), async (req, res, next) => {
  try {
    let payload;
    try {
      payload = verifyRefreshToken(req.body.refreshToken);
    } catch (_err) {
      return res.status(401).json({ error: { message: 'Invalid refresh token' } });
    }
    if (!payload || payload.type !== 'refresh') {
      return res.status(401).json({ error: { message: 'Invalid refresh token' } });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: { message: 'Invalid refresh token' } });
    }
    const tokens = issuePair(user);
    return res.json({
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        memberId: user.memberId,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    if (!user) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    return res.json({ user: safeUser(user) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
