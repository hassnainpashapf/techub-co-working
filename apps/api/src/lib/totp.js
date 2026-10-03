// TOTP secret helpers: transparent read of encrypted-or-legacy secrets +
// auto-migration of legacy plaintext secrets after a successful verify.
//
// Detection is by the "gcm1:" prefix (see lib/crypto.js), so there is no
// ambiguity: prefixed values are ALWAYS decrypted (a decrypt failure is a
// hard error — wrong key or tampered data — never silently treated as
// plaintext), and unprefixed values are legacy plaintext.
const { encryptSecret, decryptSecret, ENCRYPTED_PREFIX } = require('./crypto');
const prisma = require('./prisma');

// Returns { secret, legacy } — legacy=true means the stored value was
// plaintext (pre-encryption era). Throws on corrupt/wrong-key ciphertext.
function resolveTotpSecret(stored) {
  if (!stored) return { secret: null, legacy: false };
  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    return { secret: decryptSecret(stored), legacy: false };
  }
  return { secret: stored, legacy: true };
}

// After a successful TOTP verify, re-encrypt a legacy plaintext secret in
// place so the row becomes encrypted at rest. Returns true when migrated.
async function maybeMigrateTotpSecret(userId, stored) {
  if (!stored || stored.startsWith(ENCRYPTED_PREFIX)) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptSecret(stored) },
  });
  return true;
}

module.exports = { resolveTotpSecret, maybeMigrateTotpSecret };
