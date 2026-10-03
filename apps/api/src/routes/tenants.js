const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { hashPassword } = require('../lib/auth');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');

const router = express.Router();

// super_admin only — global tenant management
router.use(authenticate, requireRole('super_admin'));

const createTenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  plan: z.string().default('starter'),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6),
});

const updateTenantSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    plan: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

router.get('/', async (_req, res, next) => {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, members: true, units: true, bookings: true } },
      },
    });
    return res.json({ tenants });
  } catch (err) {
    return next(err);
  }
});

// SaaS overview stats (super_admin only)
router.get('/overview', async (_req, res, next) => {
  try {
    const [tenantCount, userCount, memberCount, bookingCount] = await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
      prisma.member.count(),
      prisma.booking.count(),
    ]);
    const revenue = await prisma.payment.aggregate({ _sum: { amount: true } });
    const tenantsByPlan = await prisma.tenant.groupBy({ by: ['plan'], _count: true });
    res.json({
      overview: {
        tenants: tenantCount,
        users: userCount,
        members: memberCount,
        bookings: bookingCount,
        totalRevenue: Number(revenue._sum.amount || 0),
        byPlan: Object.fromEntries(tenantsByPlan.map((t) => [t.plan, t._count])),
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(createTenantSchema), async (req, res, next) => {
  try {
    const {
      name,
      slug,
      email,
      phone,
      address,
      plan,
      adminName,
      adminEmail,
      adminPassword,
    } = req.body;

    // Phase 28: password policy
    const { validatePassword } = require('../lib/password');
    const pwCheck = validatePassword(adminPassword);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: { message: pwCheck.errors.join(' ') } });
    }

    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      return res
        .status(400)
        .json({ error: { message: 'Admin email is already in use' } });
    }

    // Transaction: create the tenant and its first admin user together.
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { name, slug, email, phone, address, plan },
      });
      await tx.user.create({
        data: {
          tenantId: created.id,
          name: adminName,
          email: adminEmail,
          passwordHash: await hashPassword(adminPassword),
          role: 'admin',
        },
      });
      return created;
    });

    return res.status(201).json({ tenant });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return res
        .status(400)
        .json({ error: { message: 'Tenant slug is already in use' } });
    }
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true, members: true } } },
    });
    if (!tenant) {
      return res.status(404).json({ error: { message: 'Tenant not found' } });
    }
    return res.json({ tenant });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', validateBody(updateTenantSchema), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.update({
      where: { id: req.params.id },
      data: req.body,
    });
    return res.json({ tenant });
  } catch (err) {
    if (err && err.code === 'P2025') {
      return res.status(404).json({ error: { message: 'Tenant not found' } });
    }
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const withCounts = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true, members: true } } },
    });
    if (!withCounts) {
      return res.status(404).json({ error: { message: 'Tenant not found' } });
    }
    if (withCounts._count.users > 0 || withCounts._count.members > 0) {
      return res.status(400).json({
        error: {
          message: 'Cannot delete tenant with users or members',
        },
      });
    }
    await prisma.tenant.delete({ where: { id: req.params.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
