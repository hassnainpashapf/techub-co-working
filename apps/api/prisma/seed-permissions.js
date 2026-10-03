// Seed granular permissions + role-permission matrix (Phase 1).
// Usage: node prisma/seed-permissions.js
// Safe to re-run (upserts).

const { PrismaClient } = require('@prisma/client');
const { PERMISSIONS, permissionsForRole } = require('../../../packages/permissions');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding permissions...');

  // 1. Upsert all permission definitions
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description, module: p.module },
      create: { key: p.key, description: p.description, module: p.module },
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions`);

  // 2. Build role -> permission links
  const allPerms = await prisma.permission.findMany();
  const permByKey = Object.fromEntries(allPerms.map((p) => [p.key, p.id]));

  const roles = [
    'super_admin', 'ceo', 'admin',
    'operations_manager', 'manager', 'finance_officer',
    'receptionist', 'office_boy', 'member',
  ];

  let linkCount = 0;
  for (const role of roles) {
    const keys = permissionsForRole(role);
    for (const key of keys) {
      const permissionId = permByKey[key];
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role, permissionId } },
        update: {},
        create: { role, permissionId },
      });
      linkCount++;
    }
  }
  console.log(`  ✓ ${linkCount} role-permission links across ${roles.length} roles`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
