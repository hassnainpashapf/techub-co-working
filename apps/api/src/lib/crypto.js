// TOTP secret encryption — AES-256-GCM.
//
// KEY POLICY (documented decision):
//   - `TOTP_ENCRYPTION_KEY` must be 64 hex chars (32 bytes). Generate with:
//       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   - Missing/invalid key + NODE_ENV=production  →  throw at startup (fail fast;
//     production must NEVER run with an ephemeral key, or encrypted secrets
//     become unreadable after restart).
//   - Missing/invalid key + non-production      →  console.warn + ephemeral
//     random key (dev convenience only; secrets won't survive restart).
//
// FORMAT: "gcm1:" + base64(iv[12] || authTag[16] || ciphertext).
// The prefix makes encrypted values unambiguous vs legacy plaintext secrets,
// so verify flows can auto-migrate old rows without a schema change.
const crypto = require('crypto');

const ENCRYPTED_PREFIX = 'gcm1:';
const KEY_ENV = 'TOTP_ENCRYPTION_KEY';

function loadKey() {
  const raw = (process.env[KEY_ENV] || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[crypto] ${KEY_ENV} is missing or invalid in production — set a 64-char hex key (32 bytes). ` +
        'Refusing to start rather than run with an unusable key.'
    );
  }
  console.warn(
    `[crypto] WARNING: ${KEY_ENV} not set or invalid — using an ephemeral random key. ` +
      'Encrypted TOTP secrets will NOT survive a restart. Dev only.'
  );
  return crypto.randomBytes(32);
}

const KEY = loadKey();

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptSecret(enc) {
  if (typeof enc !== 'string' || !enc.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error('not an encrypted TOTP secret');
  }
  const buf = Buffer.from(enc.slice(ENCRYPTED_PREFIX.length), 'base64');
  if (buf.length < 12 + 16 + 1) {
    throw new Error('malformed encrypted TOTP secret');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag); // throws on wrong key / tampered data
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret, ENCRYPTED_PREFIX, KEY_ENV };
