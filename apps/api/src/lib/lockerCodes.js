// Phase 56 Track 4: Locker access codes lib.
// PINs bcrypt-hash hote hain (Phase 48 smart-lock pattern) — plain PIN kabhi store nahi hota.
// Plain PIN sirf issue/rotate ke response me EK dafa milta hai; door/locker hardware
// `verifyLockerCode` se check karega.
//
// Track 5+ (locker hardware webhook / member portal) helper:
//   const { issueLockerCode, rotateLockerCode, verifyLockerCode } = require('./lockerCodes');

const prisma = require('./prisma');
const { hashPassword, comparePassword } = require('./auth');

// Migration se pehle graceful fail (koi 500 nahi).
function modelReady() {
  return prisma && typeof prisma.lockerCode?.findUnique === 'function';
}

function randomPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Hash kabhi bahar nahi jata.
function publicCode(c) {
  if (!c) return null;
  return {
    id: c.id,
    lockerId: c.lockerId,
    isActive: c.isActive,
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
    createdAt: c.createdAt,
  };
}

function expired(code) {
  return !!(code.expiresAt && new Date(code.expiresAt) < new Date());
}

// Naya code issue karein (purana active code auto-deactivate). Returns { code, pin } — pin sirf yahin plain.
async function issueLockerCode(tenantId, lockerId, { expiresAt = null, issuedBy = null } = {}) {
  if (!modelReady()) throw new Error('migration_pending');
  await prisma.lockerCode.updateMany({
    where: { tenantId, lockerId, isActive: true },
    data: { isActive: false },
  });
  const pin = randomPin();
  const created = await prisma.lockerCode.create({
    data: {
      tenantId,
      lockerId,
      codeHash: await hashPassword(pin),
      isActive: true,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      issuedBy,
    },
  });
  return { code: publicCode(created), pin };
}

// Purana code rotate karein — same as issue (audit me alag action).
async function rotateLockerCode(tenantId, lockerId, opts = {}) {
  return issueLockerCode(tenantId, lockerId, opts);
}

// Smart-lock / hardware webhook ke liye verify: { ok, reason }.
async function verifyLockerCode(tenantId, lockerId, plain) {
  if (!modelReady()) return { ok: false, reason: 'not_migrated' };
  if (!plain) return { ok: false, reason: 'missing_pin' };
  const code = await prisma.lockerCode.findFirst({
    where: { tenantId, lockerId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!code) return { ok: false, reason: 'no_code' };
  if (expired(code)) return { ok: false, reason: 'expired' };
  const match = await comparePassword(String(plain), code.codeHash);
  return match ? { ok: true, codeId: code.id } : { ok: false, reason: 'mismatch' };
}

// Code band karein (locker release/maintenance par).
async function deactivateLockerCode(tenantId, lockerId) {
  if (!modelReady()) throw new Error('migration_pending');
  await prisma.lockerCode.updateMany({
    where: { tenantId, lockerId, isActive: true },
    data: { isActive: false },
  });
  return { ok: true };
}

module.exports = {
  modelReady,
  publicCode,
  issueLockerCode,
  rotateLockerCode,
  verifyLockerCode,
  deactivateLockerCode,
};
