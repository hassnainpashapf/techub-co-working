// Phase 32: DB-backed refresh token rotation with reuse detection.
// Opaque 64-byte tokens; only sha256 hashes are stored (never plaintext).
const crypto = require('crypto');
const prisma = require('./prisma');

const TTL_MS =
  (parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10) || 7) * 24 * 3600 * 1000;

function hashToken(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}

class TokenReuseError extends Error {
  constructor(userId, recordId) {
    super('Refresh token reuse detected');
    this.code = 'TOKEN_REUSE';
    this.userId = userId;
    this.recordId = recordId;
  }
}

async function issueRefreshToken(userId, { ip = null, ua = null } = {}) {
  const token = crypto.randomBytes(64).toString('hex'); // 128 hex chars
  const record = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TTL_MS),
      ipAddress: ip || null,
      userAgent: ua ? String(ua).slice(0, 500) : null,
    },
  });
  return { token, record };
}

async function revokeRefreshToken(plainToken) {
  if (!plainToken) return 0;
  const r = await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(plainToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

async function revokeAllForUser(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Returns { token, record, userId } on success, null when unknown/expired.
// Throws TokenReuseError when a revoked token is presented again (possible theft).
async function rotateRefreshToken(plainToken, { ip = null, ua = null } = {}) {
  if (!plainToken) return null;
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(plainToken) },
  });
  if (!existing) return null; // unknown token — caller may try legacy JWT fallback
  if (existing.revokedAt) {
    // Reuse of a rotated/revoked token -> possible theft: kill every session.
    await revokeAllForUser(existing.userId);
    throw new TokenReuseError(existing.userId, existing.id);
  }
  if (existing.expiresAt.getTime() < Date.now()) {
    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return null;
  }
  const token = crypto.randomBytes(64).toString('hex');
  const record = await prisma.$transaction(async (tx) => {
    const rec = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TTL_MS),
        ipAddress: ip || null,
        userAgent: ua ? String(ua).slice(0, 500) : null,
      },
    });
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedBy: rec.id },
    });
    return rec;
  });
  return { token, record, userId: existing.userId };
}

module.exports = {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  hashToken,
  TokenReuseError,
};
