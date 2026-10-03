// Auth helpers: password hashing (bcryptjs) and JWT signing (jsonwebtoken).
// Token payload: { sub, role, tenantId, email, memberId, type }.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const ACCESS_SECRET = () => process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET;
const ACCESS_TTL = () => process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL = () => process.env.JWT_REFRESH_TTL || '7d';

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

function buildPayload(user, type) {
  return {
    sub: user.id,
    role: user.role,
    tenantId: user.tenantId || null,
    email: user.email,
    memberId: user.memberId || null,
    type,
  };
}

function signAccessToken(user, extra = {}) {
  return jwt.sign({ ...buildPayload(user, 'access'), ...extra }, ACCESS_SECRET(), {
    expiresIn: ACCESS_TTL(),
  });
}

function signRefreshToken(user) {
  return jwt.sign(buildPayload(user, 'refresh'), REFRESH_SECRET(), {
    expiresIn: REFRESH_TTL(),
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET());
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET());
}

// Short-lived pre-2FA token (5 min) — authorizes the 2FA verification step only.
function signPreAuthToken(user) {
  return jwt.sign({ ...buildPayload(user, 'pre2fa'), pre2fa: true }, ACCESS_SECRET(), {
    expiresIn: '5m',
  });
}

function verifyPreAuthToken(token) {
  const payload = jwt.verify(token, ACCESS_SECRET());
  if (payload.type !== 'pre2fa' || !payload.pre2fa) {
    throw new Error('Invalid pre-auth token');
  }
  return payload;
}

// Phase 35: short-lived impersonation token for super_admin tenant management.
// 15 minutes, carries impersonatedBy (the super_admin user id) so every action
// is auditable and the frontend can show an "impersonating" banner.
function signImpersonationToken(user, impersonatorId) {
  return jwt.sign(
    { ...buildPayload(user, 'access'), impersonated: true, impersonatedBy: impersonatorId },
    ACCESS_SECRET(),
    { expiresIn: '15m' }
  );
}

module.exports = {
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signPreAuthToken,
  verifyPreAuthToken,
  signImpersonationToken,
};
