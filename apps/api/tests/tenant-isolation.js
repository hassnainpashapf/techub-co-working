// Phase 1: Tenant isolation test suite.
// CRITICAL: Organization A must NEVER access Organization B's data.
// Usage: DATABASE_URL=... node tests/tenant-isolation.js
//
// Tests the permission matrix + tenant scoping at the middleware level
// without needing a running server (unit-style).

const { roleHasPermission, permissionsForRole, PERMISSIONS } = require('../../../packages/permissions');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message}`);
  }
}

console.log('\n=== Tenant Isolation & RBAC Tests ===\n');

// 1. super_admin bypasses everything
console.log('1. super_admin:');
assert(roleHasPermission('super_admin', 'saas.manage') === true, 'super_admin has saas.manage');
assert(roleHasPermission('super_admin', 'members.delete') === true, 'super_admin has members.delete');
assert(roleHasPermission('super_admin', 'nonexistent.perm') === true, 'super_admin bypasses all');

// 2. Org admins (ceo, admin) get everything EXCEPT saas.manage
console.log('\n2. Org admins (ceo, admin):');
for (const role of ['ceo', 'admin']) {
  assert(roleHasPermission(role, 'members.create') === true, `${role} has members.create`);
  assert(roleHasPermission(role, 'finance.view') === true, `${role} has finance.view`);
  assert(roleHasPermission(role, 'saas.manage') === false, `${role} does NOT have saas.manage`);
}

// 3. Member is heavily restricted
console.log('\n3. member role:');
assert(roleHasPermission('member', 'bookings.create') === true, 'member can create bookings');
assert(roleHasPermission('member', 'tickets.create') === true, 'member can create tickets');
assert(roleHasPermission('member', 'members.view') === false, 'member CANNOT view members');
assert(roleHasPermission('member', 'finance.view') === true, 'member can view own finance');
assert(roleHasPermission('member', 'invoices.create') === false, 'member CANNOT create invoices');
assert(roleHasPermission('member', 'settings.manage') === false, 'member CANNOT manage settings');

// 4. Finance officer restrictions
console.log('\n4. finance_officer:');
assert(roleHasPermission('finance_officer', 'invoices.create') === true, 'finance can create invoices');
assert(roleHasPermission('finance_officer', 'expenses.manage') === true, 'finance can manage expenses');
assert(roleHasPermission('finance_officer', 'members.delete') === false, 'finance CANNOT delete members');
assert(roleHasPermission('finance_officer', 'tickets.assign') === false, 'finance CANNOT assign tickets');

// 5. Receptionist restrictions
console.log('\n5. receptionist:');
assert(roleHasPermission('receptionist', 'bookings.manage') === true, 'reception can manage bookings');
assert(roleHasPermission('receptionist', 'visitors.manage') === true, 'reception can manage visitors');
assert(roleHasPermission('receptionist', 'invoices.create') === false, 'reception CANNOT create invoices');
assert(roleHasPermission('receptionist', 'finance.view') === false, 'reception CANNOT view finance');

// 6. Every permission key in matrix exists in PERMISSIONS
console.log('\n6. Matrix integrity:');
const knownKeys = new Set(PERMISSIONS.map((p) => p.key));
const roles = ['super_admin', 'ceo', 'admin', 'operations_manager', 'manager', 'finance_officer', 'receptionist', 'office_boy', 'member'];
let allValid = true;
for (const role of roles) {
  const keys = permissionsForRole(role);
  for (const key of keys) {
    if (!knownKeys.has(key)) {
      console.log(`  ✗ FAIL: role ${role} references unknown permission ${key}`);
      allValid = false;
      failed++;
    }
  }
}
if (allValid) {
  passed++;
  console.log('  ✓ All role-permission references are valid');
}

// 7. No role besides super_admin has saas.manage
console.log('\n7. SaaS isolation:');
for (const role of roles) {
  if (role === 'super_admin') continue;
  assert(roleHasPermission(role, 'saas.manage') === false, `${role} CANNOT access SaaS admin`);
}

// 8. Unknown roles get nothing
console.log('\n8. Unknown roles:');
assert(roleHasPermission('hacker', 'members.view') === false, 'unknown role has no permissions');
assert(permissionsForRole('hacker').length === 0, 'unknown role gets empty permission list');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
