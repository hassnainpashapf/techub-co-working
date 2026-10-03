// Phase 35 Track 9: Tenant onboarding wizard helpers.
//
// - generateTempPassword(): password-policy-compliant one-time password.
// - forcePasswordChange flag: stored in the tenant Setting row
//   `forcePasswordChange` (JSON array of userIds) so no migration is needed.
//   auth.js login responses include `mustChangePassword: true` when flagged.
const crypto = require('crypto');

const prisma = require('./prisma');

const FLAG_KEY = 'forcePasswordChange';

function generateTempPassword() {
  // Policy: >=8 chars, 1 uppercase, 1 number (lib/password.js).
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (chars, n) =>
    Array.from({ length: n }, () => chars[crypto.randomInt(chars.length)]).join('');
  const raw = pick(upper, 2) + pick(lower, 4) + pick(digits, 2) + pick(upper + lower + digits, 4);
  const arr = raw.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return 'Tmp-' + arr.join('');
}

async function _flaggedIds(tenantId) {
  if (!tenantId) return [];
  try {
    const row = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: FLAG_KEY } },
    });
    if (!row || !row.value) return [];
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function _saveFlagged(tenantId, ids) {
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: FLAG_KEY } },
    update: { value: JSON.stringify(ids) },
    create: { tenantId, key: FLAG_KEY, value: JSON.stringify(ids) },
  });
}

async function flagPasswordChange(tenantId, userId) {
  if (!tenantId || !userId) return;
  const ids = await _flaggedIds(tenantId);
  if (!ids.includes(userId)) ids.push(userId);
  await _saveFlagged(tenantId, ids);
}

async function clearPasswordChange(tenantId, userId) {
  if (!tenantId || !userId) return;
  await _saveFlagged(
    tenantId,
    (await _flaggedIds(tenantId)).filter((id) => id !== userId)
  );
}

async function mustChangePassword(tenantId, userId) {
  if (!tenantId || !userId) return false;
  return (await _flaggedIds(tenantId)).includes(userId);
}

module.exports = {
  generateTempPassword,
  flagPasswordChange,
  clearPasswordChange,
  mustChangePassword,
};
