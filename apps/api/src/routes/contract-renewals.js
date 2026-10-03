// Phase 29 Track 4: Contract renewals — expiring list + renewal.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'manager'));

// GET /api/contract-renewals/expiring?days=30
router.get('/expiring', async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const contracts = await prisma.contract.findMany({
      where: {
        ...tenantFilter(req),
        status: 'active',
        endDate: { not: null, gte: now, lte: cutoff },
      },
      include: {
        member: { select: { id: true, name: true, phone: true } },
        unit: { select: { id: true, code: true, type: true } },
      },
      orderBy: { endDate: 'asc' },
    });
    const items = contracts.map((c) => ({
      ...c,
      daysLeft: Math.ceil((new Date(c.endDate) - now) / (24 * 60 * 60 * 1000)),
    }));
    return res.json({ items });
  } catch (err) {
    return next(err);
  }
});

const renewSchema = z.object({
  endDate: z.coerce.date(),
  rentAmount: z.number().nonnegative().optional(),
});

// POST /api/contract-renewals/:id/renew
router.post('/:id/renew', validateBody(renewSchema), async (req, res, next) => {
  try {
    const old = await prisma.contract.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { member: { select: { name: true } }, unit: { select: { code: true } } },
    });
    if (!old) return res.status(404).json({ error: { message: 'Contract not found.' } });
    if (old.status !== 'active') {
      return res.status(400).json({ error: { message: 'Only active contracts can be renewed.' } });
    }
    const newStart = old.endDate ? new Date(old.endDate) : new Date();
    newStart.setDate(newStart.getDate() + 1);
    if (req.body.endDate <= newStart) {
      return res.status(400).json({ error: { message: 'New end date must be after the current end date.' } });
    }
    const result = await prisma.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: old.id }, data: { status: 'expired' } });
      const created = await tx.contract.create({
        data: {
          tenantId: old.tenantId,
          memberId: old.memberId,
          unitId: old.unitId,
          startDate: newStart,
          endDate: req.body.endDate,
          rentAmount: req.body.rentAmount ?? old.rentAmount,
          planId: old.planId,
          status: 'active',
        },
        include: {
          member: { select: { id: true, name: true } },
          unit: { select: { id: true, code: true } },
        },
      });
      return created;
    });
    await writeAudit({
      tenantId: old.tenantId,
      actorId: req.user.sub,
      action: 'contract.renewed',
      entity: 'Contract',
      entityId: result.id,
      newValue: { oldContractId: old.id, member: old.member?.name, unit: old.unit?.code },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.status(201).json({ contract: result, oldContractId: old.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
