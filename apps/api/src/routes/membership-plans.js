const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const write = requireRole(...WRITE_ROLES);

const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly'];
const UNIT_TYPES = ['hot_desk', 'dedicated_desk', 'cabin', 'meeting_room', 'phone_booth'];

const planSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  price: z.number().positive(),
  billingCycle: z.enum(BILLING_CYCLES).default('monthly'),
  unitType: z.enum(UNIT_TYPES).optional().nullable(),
  features: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});
const planUpdateSchema = planSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

// List plans (tenant-scoped)
router.get('/', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
    if (req.query.search) {
      where.name = { contains: String(req.query.search), mode: 'insensitive' };
    }
    const plans = await prisma.membershipPlan.findMany({
      where,
      orderBy: { price: 'asc' },
      include: { _count: { select: { contracts: true } } },
    });
    res.json({ plans });
  } catch (e) { next(e); }
});

// Get one plan
router.get('/:id', async (req, res, next) => {
  try {
    const plan = await prisma.membershipPlan.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: {
        contracts: {
          include: { member: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan });
  } catch (e) { next(e); }
});

// Create plan
router.post('/', write, validateBody(planSchema), async (req, res, next) => {
  try {
    const data = { ...req.body, tenantId: req.user.tenantId };
    const plan = await prisma.membershipPlan.create({ data });
    await writeAudit(req, 'plan.create', 'MembershipPlan', plan.id, null, { name: plan.name });
    res.status(201).json({ plan });
  } catch (e) { next(e); }
});

// Update plan
router.patch('/:id', write, validateBody(planUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.membershipPlan.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Plan not found' });
    const plan = await prisma.membershipPlan.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await writeAudit(req, 'plan.update', 'MembershipPlan', plan.id, { name: existing.name }, { name: plan.name });
    res.json({ plan });
  } catch (e) { next(e); }
});

// Delete plan (only if no contracts use it)
router.delete('/:id', write, async (req, res, next) => {
  try {
    const plan = await prisma.membershipPlan.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { _count: { select: { contracts: true } } },
    });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan._count.contracts > 0) {
      return res.status(400).json({ error: 'Plan is used by contracts and cannot be deleted' });
    }
    await prisma.membershipPlan.delete({ where: { id: req.params.id } });
    await writeAudit(req, 'plan.delete', 'MembershipPlan', req.params.id, { name: plan.name }, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
