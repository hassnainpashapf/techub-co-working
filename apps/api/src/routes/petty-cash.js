// Phase 31 Track 6: Petty cash register.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

// Money handling: ceo / admin / finance / manager only.
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'finance_officer', 'manager', 'super_admin'));

const txSchema = z.object({
  type: z.enum(['in', 'out']),
  amount: z.number().positive(),
  reason: z.string().min(1),
  category: z.string().optional().nullable(),
});

// List with filters + running balance summary
router.get('/', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.type === 'in' || req.query.type === 'out') where.type = req.query.type;
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(req.query.from);
      if (req.query.to) where.createdAt.lte = new Date(req.query.to);
    }
    const [items, agg] = await Promise.all([
      prisma.pettyCashTransaction.findMany({
        where,
        include: { performer: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.pettyCashTransaction.groupBy({
        by: ['type'],
        where: { ...tenantFilter(req) },
        _sum: { amount: true },
      }),
    ]);
    const totalIn = Number((agg.find((a) => a.type === 'in') || {})._sum?.amount || 0);
    const totalOut = Number((agg.find((a) => a.type === 'out') || {})._sum?.amount || 0);
    res.json({
      items,
      summary: { totalIn, totalOut, balance: totalIn - totalOut },
    });
  } catch (e) { next(e); }
});

// Record cash in/out
router.post('/', validateBody(txSchema), async (req, res, next) => {
  try {
    const tx = await prisma.pettyCashTransaction.create({
      data: {
        ...tenantFilter(req),
        type: req.body.type,
        amount: req.body.amount,
        reason: req.body.reason,
        category: req.body.category || null,
        performedBy: req.user.sub,
      },
      include: { performer: { select: { id: true, name: true } } },
    });
    writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'petty_cash.recorded',
      entity: 'PettyCashTransaction',
      entityId: tx.id,
      newValue: { type: tx.type, amount: Number(tx.amount), reason: tx.reason },
    }).catch(() => {});
    res.status(201).json({ transaction: tx });
  } catch (e) { next(e); }
});

// Delete a wrong entry (ceo/admin only)
router.delete('/:id', requireRole('ceo', 'admin', 'super_admin'), async (req, res, next) => {
  try {
    const existing = await prisma.pettyCashTransaction.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: { message: 'Transaction not found.' } });
    await prisma.pettyCashTransaction.delete({ where: { id: req.params.id } });
    writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'petty_cash.deleted',
      entity: 'PettyCashTransaction',
      entityId: req.params.id,
      oldValue: { type: existing.type, amount: Number(existing.amount), reason: existing.reason },
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
