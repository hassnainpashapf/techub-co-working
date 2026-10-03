// Shared permission constants — single source of truth for API + Web.
// RBAC matrix (see COWORKOS_ARCHITECTURE.md Section 6).

// Role mapping (existing enum → matrix columns):
//   super_admin        → Super Admin
//   ceo, admin         → Organization Admin
//   operations_manager, manager → Branch Manager
//   finance_officer    → Finance Manager
//   receptionist       → Receptionist
//   office_boy         → Support + Maintenance Staff

const PERMISSIONS = [
  // SaaS platform
  { key: 'saas.manage', module: 'saas', description: 'Manage SaaS platform (plans, orgs, analytics)' },
  // Members
  { key: 'members.view', module: 'members', description: 'View members' },
  { key: 'members.create', module: 'members', description: 'Create members' },
  { key: 'members.edit', module: 'members', description: 'Edit members' },
  { key: 'members.delete', module: 'members', description: 'Delete members' },
  // Companies
  { key: 'companies.view', module: 'companies', description: 'View companies' },
  { key: 'companies.manage', module: 'companies', description: 'Create/edit/delete companies' },
  // Memberships
  { key: 'memberships.view', module: 'memberships', description: 'View memberships' },
  { key: 'memberships.manage', module: 'memberships', description: 'Create/edit/cancel memberships' },
  // Spaces
  { key: 'spaces.view', module: 'spaces', description: 'View spaces' },
  { key: 'spaces.manage', module: 'spaces', description: 'Create/edit spaces' },
  // Bookings
  { key: 'bookings.view', module: 'bookings', description: 'View bookings' },
  { key: 'bookings.create', module: 'bookings', description: 'Create bookings' },
  { key: 'bookings.manage', module: 'bookings', description: 'Manage all bookings' },
  // Tickets
  { key: 'tickets.view', module: 'tickets', description: 'View tickets' },
  { key: 'tickets.create', module: 'tickets', description: 'Create tickets' },
  { key: 'tickets.assign', module: 'tickets', description: 'Assign tickets' },
  { key: 'tickets.close', module: 'tickets', description: 'Resolve/close tickets' },
  // Maintenance
  { key: 'maintenance.view', module: 'maintenance', description: 'View maintenance' },
  { key: 'maintenance.manage', module: 'maintenance', description: 'Manage work orders & assets' },
  // Finance
  { key: 'finance.view', module: 'finance', description: 'View finance data' },
  { key: 'invoices.create', module: 'finance', description: 'Create/edit invoices' },
  { key: 'payments.record', module: 'finance', description: 'Record payments' },
  { key: 'expenses.manage', module: 'finance', description: 'Manage expenses' },
  // Operations
  { key: 'visitors.manage', module: 'operations', description: 'Manage visitors' },
  { key: 'staff.manage', module: 'operations', description: 'Manage staff' },
  { key: 'inventory.manage', module: 'operations', description: 'Manage inventory' },
  { key: 'assets.manage', module: 'operations', description: 'Manage assets' },
  { key: 'contracts.manage', module: 'operations', description: 'Manage contracts' },
  { key: 'attendance.manage', module: 'operations', description: 'Manage attendance' },
  // Platform
  { key: 'reports.view', module: 'reports', description: 'View reports' },
  { key: 'audit.view', module: 'audit', description: 'View audit logs' },
  { key: 'settings.manage', module: 'settings', description: 'Manage organization settings' },
  { key: 'notifications.manage', module: 'notifications', description: 'Manage notifications' },
];

// Branch-scoped roles: these permissions apply only to assigned branches
// (enforced via branch_id scoping in queries).
const BRANCH_SCOPED = new Set([
  'operations_manager',
  'manager',
  'receptionist',
]);

// Full matrix: role -> permission keys ('*' = all)
const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  ceo: ['*'], // org admin — all except saas.manage
  admin: ['*'], // org admin — all except saas.manage
  operations_manager: [
    'members.view', 'members.create', 'members.edit',
    'companies.view',
    'memberships.view',
    'spaces.view',
    'bookings.view', 'bookings.create', 'bookings.manage',
    'tickets.view', 'tickets.create', 'tickets.assign', 'tickets.close',
    'maintenance.view', 'maintenance.manage',
    'visitors.manage',
    'inventory.manage', 'assets.manage',
    'attendance.manage',
    'reports.view',
    'notifications.manage',
  ],
  manager: [
    'members.view', 'members.create', 'members.edit',
    'companies.view',
    'memberships.view',
    'spaces.view',
    'bookings.view', 'bookings.create', 'bookings.manage',
    'tickets.view', 'tickets.create', 'tickets.assign', 'tickets.close',
    'maintenance.view', 'maintenance.manage',
    'visitors.manage',
    'inventory.manage', 'assets.manage',
    'attendance.manage',
    'reports.view',
    'notifications.manage',
  ],
  finance_officer: [
    'members.view',
    'memberships.view',
    'bookings.view',
    'tickets.create',
    'finance.view', 'invoices.create', 'payments.record', 'expenses.manage',
    'contracts.manage',
    'reports.view',
    'notifications.manage',
  ],
  receptionist: [
    'members.view', 'members.create', 'members.edit',
    'companies.view',
    'spaces.view',
    'bookings.view', 'bookings.create', 'bookings.manage',
    'tickets.create',
    'payments.record',
    'visitors.manage',
    'attendance.manage',
    'notifications.manage',
  ],
  office_boy: [
    'tickets.view', 'tickets.create',
    'maintenance.view', 'maintenance.manage',
    'inventory.manage',
    'notifications.manage',
  ],
  member: [
    'bookings.view', 'bookings.create',
    'tickets.create',
    'finance.view', // own invoices only (enforced in query)
    'notifications.manage',
  ],
};

// Permissions excluded from '*' (org admins don't get these)
const EXCLUDED_FROM_STAR = new Set(['saas.manage']);

function permissionsForRole(role) {
  const keys = ROLE_PERMISSIONS[role];
  if (!keys) return [];
  if (keys.includes('*')) {
    return PERMISSIONS.map((p) => p.key).filter((k) => !EXCLUDED_FROM_STAR.has(k));
  }
  return keys;
}

function roleHasPermission(role, permissionKey) {
  if (role === 'super_admin') return true;
  const keys = ROLE_PERMISSIONS[role];
  if (!keys) return false;
  if (keys.includes('*')) return !EXCLUDED_FROM_STAR.has(permissionKey);
  return keys.includes(permissionKey);
}

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  BRANCH_SCOPED,
  EXCLUDED_FROM_STAR,
  permissionsForRole,
  roleHasPermission,
};
