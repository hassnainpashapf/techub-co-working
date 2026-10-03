// Audit logging — append-only, immutable to normal users.
// Logs every mutating action: who, what, when, old vs new values.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Direct DB write helper (bypasses middleware to avoid recursion)
async function writeAudit({ tenantId, actorId, action, entity, entityId, oldValue, newValue, ip, userAgent }) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: tenantId || null,
        actorId: actorId || null,
        action,
        entity,
        entityId: entityId || null,
        oldValue: oldValue ? JSON.parse(JSON.stringify(oldValue)) : null,
        newValue: newValue ? JSON.parse(JSON.stringify(newValue)) : null,
        ip: ip || null,
        userAgent: userAgent || null,
      },
    });
  } catch (e) {
    // Audit must never break the request — log to console only
    console.error('[audit] write failed:', e.message);
  }
}

// Express middleware factory: audit('member.create', 'Member')
// Captures req -> res; logs on successful mutation (2xx).
function audit(action, entity) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Only log successful mutations
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const entityId =
          req.params?.id ||
          body?.id ||
          body?.data?.id ||
          null;
        writeAudit({
          tenantId: req.user?.tenantId || req.tenantId || null,
          actorId: req.user?.id || null,
          action,
          entity,
          entityId: entityId ? String(entityId) : null,
          oldValue: req.auditOldValue || null,
          newValue: sanitizeBody(req.body),
          ip: req.ip || req.headers['x-forwarded-for'] || null,
          userAgent: req.headers['user-agent'] || null,
        });
      }
      return originalJson(body);
    };
    next();
  };
}

// Remove sensitive fields before storing
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const copy = { ...body };
  for (const k of ['password', 'passwordHash', 'token', 'secret', '2fa']) {
    if (k in copy) copy[k] = '[REDACTED]';
  }
  return copy;
}

module.exports = { writeAudit, audit, sanitizeBody };
