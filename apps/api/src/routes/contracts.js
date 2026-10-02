const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'finance_officer'];
const write = requireRole(...WRITE_ROLES);

const CONTRACT_STATUSES = ['active', 'expired', 'cancelled'];

const createContractSchema = z.object({
  memberId: z.string().min(1),
  unitId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  rentAmount: z.number().nonnegative(),
});
const updateContractSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional().nullable(),
    rentAmount: z.number().nonnegative().optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' })
  .refine((d) => !(d.startDate && d.endDate && d.endDate < d.startDate), {
    message: 'endDate cannot be before startDate',
  });

function contractScope(req) {
  const where = { ...tenantFilter(req) };
  if (req.user.role === 'member') where.memberId = req.user.memberId;
  return where;
}

router.get('/', async (req, res, next) => {
  try {
    const where = contractScope(req);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.memberId) where.memberId = String(req.query.memberId);
    const contracts = await prisma.contract.findMany({
      where,
      include: {
        member: { select: { id: true, name: true, phone: true } },
        unit: { select: { id: true, code: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ contracts });
  } catch (err) {
    return next(err);
  }
});

router.post('/', write, validateBody(createContractSchema), async (req, res, next) => {
  try {
    const { memberId, unitId, startDate, endDate, rentAmount } = req.body;
    const tf = tenantFilter(req);

    const member = await prisma.member.findFirst({ where: { id: memberId, ...tf } });
    if (!member) return res.status(400).json({ error: { message: 'Member not found' } });

    const unit = await prisma.unit.findFirst({ where: { id: unitId, ...tf } });
    if (!unit) return res.status(400).json({ error: { message: 'Unit not found' } });
    if (unit.type === 'meeting_room') {
      return res.status(400).json({
        error: { message: 'Meeting rooms cannot be contracted — use bookings' },
      });
    }

    // No two ACTIVE contracts may occupy the same unit at once.
    const clash = await prisma.contract.findFirst({
      where: { unitId, status: 'active', ...tf },
    });
    if (clash) {
      return res.status(409).json({
        error: { message: 'Unit already has an active contract' },
      });
    }

    const contract = await prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: { ...tf, memberId, unitId, startDate, endDate: endDate || null, rentAmount },
      });
      await tx.unit.update({ where: { id: unitId }, data: { status: 'occupied' } });
      return created;
    });

    return res.status(201).json({ contract });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', write, validateBody(updateContractSchema), async (req, res, next) => {
  try {
    const existing = await prisma.contract.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Contract not found' } });

    const contract = await prisma.$transaction(async (tx) => {
      const updated = await tx.contract.update({
        where: { id: existing.id },
        data: req.body,
      });
      // Contract ended/cancelled → free the unit if nothing else holds it.
      if (
        req.body.status &&
        (req.body.status === 'expired' || req.body.status === 'cancelled') &&
        existing.status === 'active'
      ) {
        const others = await tx.contract.count({
          where: {
            unitId: existing.unitId,
            status: 'active',
            id: { not: existing.id },
          },
        });
        if (others === 0) {
          await tx.unit.update({
            where: { id: existing.unitId },
            data: { status: 'vacant' },
          });
        }
      }
      return updated;
    });

    return res.json({ contract });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.contract.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Contract not found' } });
    const invoices = await prisma.invoice.count({ where: { contractId: existing.id } });
    if (invoices > 0) {
      return res.status(400).json({
        error: { message: 'Cannot delete contract: it has invoices' },
      });
    }
    await prisma.contract.delete({ where: { id: existing.id } });
    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
