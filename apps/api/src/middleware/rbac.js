// RBAC middleware.

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    return next();
  };
}

// Blocks super_admin (tenantId === null) from tenant-scoped routes.
function requireTenantUser(req, res, next) {
  if (!req.user || !req.user.tenantId) {
    return res.status(403).json({ error: { message: 'Forbidden' } });
  }
  return next();
}

module.exports = { requireRole, requireTenantUser };
