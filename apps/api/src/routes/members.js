const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const write = requireRole(...WRITE_ROLES);

const MEMBER_STATUSES = ['active', 'trial', 'on_hold', 'exited'];

const memberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(1),
  cnic: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  emergencyContact: z.string().optional().nullable(),
  status: z.enum(MEMBER_STATUSES).default('active'),
  notes: z.string().optional().nullable(),
});
const memberUpdateSchema = memberSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

function memberScope(req) {
  const where = { ...tenantFilter(req) };
  // The member portal can only ever see its own record.
  if (req.user.role === 'member') where.id = req.user.memberId;
  return where;
}

router.get('/', async (req, res, next) => {
  try {
    const where = memberScope(req);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.search) {
      const s = String(req.query.search);
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { companyName: { contains: s, mode: 'insensitive' } },
      ];
    }
    const members = await prisma.member.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ members });
  } catch (err) {
    return next(err);
  }
});

router.post('/', write, validateBody(memberSchema), async (req, res, next) => {
  try {
    const member = await prisma.member.create({
      data: { ...tenantFilter(req), ...req.body },
    });
    return res.status(201).json({ member });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'member' && req.params.id !== req.user.memberId) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    const member = await prisma.member.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: {
        contracts: {
          include: { unit: { select: { id: true, code: true, type: true } } },
          orderBy: { createdAt: 'desc' },
        },
        invoices: {
          include: { _count: { select: { payments: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!member) return res.status(404).json({ error: { message: 'Member not found' } });
    const totals = {
      invoices: member.invoices.length,
      billed: member.invoices.reduce((s, i) => s + Number(i.amount), 0),
      paid: member.invoices.reduce((s, i) => s + Number(i.amountPaid), 0),
    };
    return res.json({ member, totals });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', write, validateBody(memberUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Member not found' } });
    const member = await prisma.member.update({ where: { id: existing.id }, data: req.body });
    return res.json({ member });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Member not found' } });
    const activeContracts = await prisma.contract.count({
      where: { memberId: existing.id, status: 'active' },
    });
    if (activeContracts > 0) {
      return res.status(400).json({
        error: { message: 'Cannot delete member: they have active contracts' },
      });
    }
    await prisma.member.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
