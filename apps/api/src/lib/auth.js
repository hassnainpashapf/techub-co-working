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

function signAccessToken(user) {
  return jwt.sign(buildPayload(user, 'access'), ACCESS_SECRET(), {
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

module.exports = {
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
