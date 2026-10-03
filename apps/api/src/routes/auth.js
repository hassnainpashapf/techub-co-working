const express = require('express');
const { z } = require('zod');
const { authenticator } = require('otplib');

const prisma = require('../lib/prisma');
const { resolveTotpSecret, maybeMigrateTotpSecret } = require('../lib/totp');
const {
  comparePassword,
  signAccessToken,
  verifyRefreshToken,
  signPreAuthToken,
  verifyPreAuthToken,
} = require('../lib/auth');
const { authenticate } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimit');
// Phase 28: brute-force lockout
const { checkLockout, recordFailure, recordSuccess } = require('../lib/loginAttempts');
// Phase 32: login security (IP allowlist + new-device alerts)
const { checkIpAllowed, recordBlockedIp, trackLogin } = require('../lib/loginSecurity');
const { writeAudit } = require('../middleware/audit');
// Phase 32 Track 5: login session tracking (session manager UI)
const { recordLoginSession, latestActiveSession } = require('../lib/userSessions');
// Phase 35 Track 9: force temp-password change flag (tenant onboarding wizard)
const { mustChangePassword } = require('../lib/onboarding');
// Phase 32: DB-backed refresh token rotation
const {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  TokenReuseError,
} = require('../lib/refreshTokens');

const router = express.Router();

// --- refresh-token cookie helpers (no cookie-parser dependency) ---
const REFRESH_COOKIE = 'cw_refresh';
function parseCookies(req) {
  const out = {};
  const header = req.headers && req.headers.cookie;
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/api/auth',
  });
}
function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function safeUser(user) {
  if (!user) return null;
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

// Phase 32: issue access JWT + DB-backed rotating refresh token; sets httpOnly cookie.
// Returns { accessToken, refreshToken } — refreshToken is an opaque one-time value.
async function issueLoginPair(user, req, res) {
  // Phase 32 Track 5: record login session (device/IP); bind its id as `sid` on the access token
  const loginSession = await recordLoginSession(req, user);
  const accessToken = signAccessToken(user, loginSession ? { sid: loginSession.id } : {});
  const { token } = await issueRefreshToken(user.id, {
    ip: req.ip,
    ua: req.headers['user-agent'],
  });
  setRefreshCookie(res, token);
  return { accessToken, refreshToken: token };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    memberId: user.memberId,
  };
}

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    // Phase 28: brute-force lockout (per email+IP)
    const lock = checkLockout(email, req.ip);
    if (lock.locked) {
      return res.status(429).json({
        error: { message: `Too many failed attempts. Try again in ${lock.retryMin} minute(s).` },
      });
    }
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: { select: { id: true, name: true, slug: true, isActive: true, suspendedAt: true } } },
    });
    if (!user || !user.isActive) {
      recordFailure(email, req.ip);
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }
    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) {
      recordFailure(email, req.ip);
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }
    recordSuccess(email, req.ip);
    // Phase 35: suspended tenant → login blocked (super_admin has no tenant, skips this)
    if (user.tenant && (user.tenant.isActive === false || user.tenant.suspendedAt)) {
      return res.status(403).json({
        error: { message: 'This workspace has been suspended. Please contact support.', code: 'TENANT_SUSPENDED' },
      });
    }
    // Phase 32: IP allowlist enforcement (applies to all roles; empty = disabled)
    const ipCheck = await checkIpAllowed(user.tenantId, req.ip);
    if (!ipCheck.allowed) {
      recordBlockedIp(user.tenantId, user, req.ip, req.headers['user-agent']);
      return res.status(403).json({
        error: { message: 'Login from this IP address is not allowed.', code: 'IP_NOT_ALLOWED' },
      });
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
    const tokens = await issueLoginPair(user, req, res);
    // Phase 32: new-device / suspicious login alert (fire-and-forget)
    trackLogin(user.tenantId, user, req.ip, req.headers['user-agent']);
    await writeAudit({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    // Phase 35 Track 9: tell the frontend when a temp password must be changed
    const forcePwChange = await mustChangePassword(user.tenantId, user.id).catch(() => false);
    return res.json({
      ...tokens,
      user: {
        ...publicUser(user),
        tenant: user.tenant ? user.tenant.name : null,
        ...(forcePwChange ? { mustChangePassword: true } : {}),
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
    const { secret } = resolveTotpSecret(user.totpSecret); // decrypts, or legacy plaintext
    const ok = authenticator.verify({ token: code, secret });
    if (!ok) {
      return res.status(401).json({ error: { message: 'Invalid 2FA code.' } });
    }
    // Auto-migrate legacy plaintext secret to encrypted on successful 2FA login.
    await maybeMigrateTotpSecret(user.id, user.totpSecret);
    // Phase 32: IP allowlist enforcement (applies to all roles; empty = disabled)
    const ipCheck2fa = await checkIpAllowed(user.tenantId, req.ip);
    if (!ipCheck2fa.allowed) {
      recordBlockedIp(user.tenantId, user, req.ip, req.headers['user-agent']);
      return res.status(403).json({
        error: { message: 'Login from this IP address is not allowed.', code: 'IP_NOT_ALLOWED' },
      });
    }
    const tokens = await issueLoginPair(user, req, res);
    // Phase 32: new-device / suspicious login alert (fire-and-forget)
    trackLogin(user.tenantId, user, req.ip, req.headers['user-agent']);
    await writeAudit({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    // Phase 35 Track 9: tell the frontend when a temp password must be changed
    const forcePwChange = await mustChangePassword(user.tenantId, user.id).catch(() => false);
    return res.json({
      ...tokens,
      user: {
        ...publicUser(user),
        tenant: user.tenant ? user.tenant.name : null,
        ...(forcePwChange ? { mustChangePassword: true } : {}),
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Phase 32: rotate a refresh token. Accepts body { refreshToken } or httpOnly cookie.
// DB rotation first; unknown tokens fall back to legacy JWT verification (migration path).
// A revoked token presented again = reuse -> all user tokens revoked + security audit.
router.post('/refresh', async (req, res, next) => {
  try {
    const presented =
      (req.body && typeof req.body.refreshToken === 'string' && req.body.refreshToken) ||
      parseCookies(req)[REFRESH_COOKIE] ||
      null;

    if (presented) {
      let rotated = null;
      try {
        rotated = await rotateRefreshToken(presented, {
          ip: req.ip,
          ua: req.headers['user-agent'],
        });
      } catch (err) {
        if (err instanceof TokenReuseError || err.code === 'TOKEN_REUSE') {
          await writeAudit({
            tenantId: null,
            actorId: err.userId,
            action: 'auth.token_reuse_detected',
            entity: 'User',
            entityId: err.userId,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          });
          clearRefreshCookie(res);
          return res.status(401).json({
            error: {
              message: 'Session compromised. All sessions revoked — please log in again.',
              code: 'TOKEN_REUSE',
            },
          });
        }
        throw err;
      }
      if (rotated) {
        const user = await prisma.user.findUnique({ where: { id: rotated.userId } });
        if (user && user.isActive) {
          // Phase 32 Track 5: keep the access token bound to the latest active login session
          const activeSession = await latestActiveSession(user.id);
          const accessToken = signAccessToken(user, activeSession ? { sid: activeSession.id } : {});
          setRefreshCookie(res, rotated.token);
          return res.json({
            accessToken,
            refreshToken: rotated.token,
            user: publicUser(user),
          });
        }
      }
      // unknown/expired/inactive -> try legacy JWT fallback below
    }

    // Legacy JWT fallback (keeps pre-Phase-32 sessions working)
    let payload;
    try {
      payload = verifyRefreshToken(presented);
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
    // Migrate legacy session onto DB rotation
    const tokens = await issueLoginPair(user, req, res);
    return res.json({ ...tokens, user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

// Phase 32: revoke the presented refresh token (body or cookie) and clear the cookie.
router.post('/logout', async (req, res, next) => {
  try {
    const presented =
      (req.body && typeof req.body.refreshToken === 'string' && req.body.refreshToken) ||
      parseCookies(req)[REFRESH_COOKIE] ||
      null;
    if (presented) {
      try {
        await revokeRefreshToken(presented);
      } catch (_e) {
        /* best-effort */
      }
    }
    clearRefreshCookie(res);
    return res.json({ ok: true });
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
