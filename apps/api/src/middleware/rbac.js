// RBAC middleware — granular permission-based access control.
// Phase 1: role-name checks replaced by permission checks.
// See: packages/permissions/index.js (single source of truth)

const { roleHasPermission } = require('../../../../packages/permissions');

// Legacy: role-name based check (kept for compatibility during migration)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    // super_admin bypasses all role checks — full access to everything
    if (req.user.role === 'super_admin' || roles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ error: { message: 'Forbidden' } });
  };
}

// New: granular permission check — requirePermission('members.create')
function requirePermission(...permissionKeys) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    // super_admin bypasses all permission checks
    if (req.user.role === 'super_admin') {
      return next();
    }
    const ok = permissionKeys.some((key) => roleHasPermission(req.user.role, key));
    if (ok) return next();
    return res.status(403).json({
      error: {
        message: 'Forbidden',
        code: 'INSUFFICIENT_PERMISSION',
        required: permissionKeys,
      },
    });
  };
}

// Blocks super_admin (tenantId === null) from tenant-scoped routes.
function requireTenantUser(req, res, next) {
  if (!req.user || !req.user.tenantId) {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }
  return next();
}

module.exports = { requireRole, requirePermission, requireTenantUser };
