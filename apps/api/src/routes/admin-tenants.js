// Phase 35 Track 10: Super Admin Tenant Management.
// Global (non-tenant-scoped) SaaS admin endpoints — super_admin only.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { signImpersonationToken } = require('../lib/auth');
const { invalidateTenantStatus } = require('../lib/tenantStatus');

const router = express.Router();

// super_admin only — tenantId === null, so no requireTenantUser here.
router.use(authenticate, requireRole('super_admin'));

function safeTenant(t) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    email: t.email,
    plan: t.plan,
    isActive: t.isActive,
    suspended: !!t.suspendedAt,
    suspendedAt: t.suspendedAt || null,
    suspendedReason: t.suspendedReason || null,
    createdAt: t.createdAt,
    counts: t._count || {},
    subscription: t.subscription
      ? { planId: t.subscription.planId, status: t.subscription.status }
      : null,
  };
}

// GET / — all tenants with usage stats
router.get('/', async (_req, res, next) => {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            users: true,
            members: true,
            units: true,
            bookings: true,
            invoices: true,
            documents: true,
          },
        },
        subscription: { select: { planId: true, status: true } },
      },
    });
    res.json({ tenants: tenants.map(safeTenant) });
  } catch (e) {
    next(e);
  }
});

const suspendSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().max(500).optional().nullable(),
});

// PATCH /:id — suspend / activate a tenant
router.patch('/:id', validateBody(suspendSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { suspended, reason } = req.body;
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return res.status(404).json({ error: { message: 'Tenant not found' } });
    }
    const updated = await prisma.tenant.update({
      where: { id },
      data: suspended
        ? { suspendedAt: new Date(), suspendedReason: reason || null }
        : { suspendedAt: null, suspendedReason: null },
      include: {
        _count: { select: { users: true, members: true, units: true, bookings: true, invoices: true, documents: true } },
        subscription: { select: { planId: true, status: true } },
      },
    });
    invalidateTenantStatus(id);
    writeAudit({
      tenantId: id,
      actorId: req.user.sub,
      action: suspended ? 'tenant.suspended' : 'tenant.activated',
      entity: 'tenant',
      entityId: id,
      newValue: { suspended, reason: reason || null },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ tenant: safeTenant(updated) });
  } catch (e) {
    next(e);
  }
});

// POST /:id/impersonate — short-lived (15 min) token as the tenant's admin.
// Every impersonated request carries impersonatedBy, and this call is audited.
router.post('/:id/impersonate', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, suspendedAt: true },
    });
    if (!tenant) {
      return res.status(404).json({ error: { message: 'Tenant not found' } });
    }
    if (tenant.suspendedAt) {
      return res.status(403).json({
        error: { message: 'Cannot impersonate a suspended tenant. Activate it first.', code: 'TENANT_SUSPENDED' },
      });
    }
    // Pick the tenant's most senior active user (ceo > admin > manager)
    const target = await prisma.user.findFirst({
      where: { tenantId: id, isActive: true, role: { in: ['ceo', 'admin', 'manager'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!target) {
      return res.status(404).json({ error: { message: 'No active staff user found in this tenant' } });
    }
    const token = signImpersonationToken(target, req.user.sub);
    writeAudit({
      tenantId: id,
      actorId: req.user.sub,
      action: 'tenant.impersonate',
      entity: 'user',
      entityId: target.id,
      newValue: { impersonatedEmail: target.email, impersonatedRole: target.role },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({
      token,
      expiresIn: '15m',
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user: { id: target.id, name: target.name, email: target.email, role: target.role },
    });
  } catch (e) {
    next(e);
  }
});

// DELETE /:id — only tenants with no real data (safety: members/users/bookings/invoices > 0 → block)
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, members: true, bookings: true, invoices: true, payments: true, contracts: true },
        },
      },
    });
    if (!tenant) {
      return res.status(404).json({ error: { message: 'Tenant not found' } });
    }
    const c = tenant._count;
    const total = c.users + c.members + c.bookings + c.invoices + c.payments + c.contracts;
    if (total > 0) {
      return res.status(400).json({
        error: {
          message: `Cannot delete: tenant has data (users: ${c.users}, members: ${c.members}, bookings: ${c.bookings}, invoices: ${c.invoices}). Suspend it instead.`,
          code: 'TENANT_NOT_EMPTY',
        },
      });
    }
    await prisma.tenant.delete({ where: { id } });
    invalidateTenantStatus(id);
    writeAudit({
      tenantId: null,
      actorId: req.user.sub,
      action: 'tenant.deleted',
      entity: 'tenant',
      entityId: id,
      oldValue: { name: tenant.name, slug: tenant.slug },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ deleted: true, id });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
