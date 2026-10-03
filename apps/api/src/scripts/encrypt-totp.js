// One-time migration: encrypt existing PLAINTEXT TOTP secrets at rest.
//
// Rows already encrypted (prefix "gcm1:") are skipped. Rows stored as legacy
// plaintext are encrypted in place with TOTP_ENCRYPTION_KEY.
//
// Additionally, the verify flows (/2fa/verify, /login/2fa) auto-migrate any
// remaining legacy secret on the next successful code verification, so this
// script is a convenience for bulk-migrating upfront — not strictly required.
//
// Usage (from apps/api):
//   TOTP_ENCRYPTION_KEY=<64-hex> node src/scripts/encrypt-totp.js [--dry-run]
require('dotenv').config();

const prisma = require('../lib/prisma');
const { encryptSecret, ENCRYPTED_PREFIX, KEY_ENV } = require('../lib/crypto');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env[KEY_ENV]) {
    console.error(`Set ${KEY_ENV} before running (64 hex chars).`);
    process.exit(1);
  }
  const users = await prisma.user.findMany({
    where: { totpSecret: { not: null } },
    select: { id: true, email: true, totpSecret: true },
  });
  let migrated = 0;
  let skipped = 0;
  for (const u of users) {
    if (u.totpSecret.startsWith(ENCRYPTED_PREFIX)) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      await prisma.user.update({
        where: { id: u.id },
        data: { totpSecret: encryptSecret(u.totpSecret) },
      });
    }
    migrated += 1;
    console.log(`${dryRun ? '[dry-run] would migrate' : 'migrated'}: ${u.email}`);
  }
  console.log(`done — ${dryRun ? 'would migrate' : 'migrated'}: ${migrated}, already encrypted: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('migration failed:', err.message);
  process.exit(1);
});
