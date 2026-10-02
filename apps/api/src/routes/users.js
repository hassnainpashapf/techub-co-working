const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { hashPassword } = require('../lib/auth');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');

const router = express.Router();

// ceo/admin manage users in their tenant; super_admin may manage any tenant by
// passing ?tenantId=<id>. super_admin has tenantId=null so it needs explicit scoping.
router.use(authenticate, requireRole('super_admin', 'ceo', 'admin'));

const ROLES = [
  'ceo',
  'admin',
  'operations_manager',
  'manager',
  'finance_officer',
  'receptionist',
  'office_boy',
  'member',
];

function resolveTenantId(req, res) {
  if (req.user.role === 'super_admin') {
    const tenantId = req.query.tenantId;
    if (!tenantId) {
      res.status(400).json({
        error: { message: 'super_admin must pass ?tenantId query parameter' },
      });
      return null;
    }
    return String(tenantId);
  }
  return req.user.tenantId;
}

function sanitize(user) {
  if (!user) return null;
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(ROLES),
  phone: z.string().optional().nullable(),
  memberId: z.string().optional().nullable(),
});

const updateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    role: z.enum(ROLES).optional(),
    phone: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    memberId: z.string().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

router.get('/', requireTenantUserOrSuper(), async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req, res);
    if (!tenantId) return;
    const users = await prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ users: users.map(sanitize) });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(createUserSchema), async (req, res, next) => {
  try {
    const tenantId = req.user.role === 'super_admin' ? resolveTenantId(req, res) : req.user.tenantId;
    if (!tenantId) return;
    const { name, email, password, role, phone, memberId } = req.body;

    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res
        .status(403)
        .json({ error: { message: 'Only super_admin can create super_admin users' } });
    }

    const user = await prisma.user.create({
      data: {
        tenantId: role === 'super_admin' ? null : tenantId,
        name,
        email,
        passwordHash: await hashPassword(password),
        role,
        phone,
        memberId: memberId || null,
      },
    });
    return res.status(201).json({ user: sanitize(user) });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return res.status(400).json({ error: { message: 'Email is already in use' } });
    }
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, ...scopeWhere(req) },
    });
    if (!user) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }
    return res.json({ user: sanitize(user) });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', validateBody(updateUserSchema), async (req, res, next) => {
  try {
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, ...scopeWhere(req) },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }
    const { password, role, ...rest } = req.body;
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        error: { message: 'Only super_admin can grant super_admin role' },
      });
    }
    const data = { ...rest };
    if (password) data.passwordHash = await hashPassword(password);
    if (role) data.role = role;
    const user = await prisma.user.update({ where: { id: existing.id }, data });
    return res.json({ user: sanitize(user) });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return res.status(400).json({ error: { message: 'Email is already in use' } });
    }
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user.sub) {
      return res.status(400).json({ error: { message: 'You cannot delete yourself' } });
    }
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, ...scopeWhere(req) },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }
    await prisma.user.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

// Where-clause scope for single-record routes: super_admin can reach any user
// (optionally narrowed by ?tenantId), everyone else is confined to their tenant.
function scopeWhere(req) {
  if (req.user.role === 'super_admin') {
    if (req.query.tenantId) return { tenantId: String(req.query.tenantId) };
    return {};
  }
  return { tenantId: req.user.tenantId };
}

// GET / listing: super_admin without ?tenantId is an error (see resolveTenantId),
// plain tenant users must have a tenant.
function requireTenantUserOrSuper() {
  return (req, res, next) => {
    if (req.user.role !== 'super_admin' && !req.user.tenantId) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    return next();
  };
}
module.exports = router;
