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

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'operations_manager', 'office_boy'];
const write = requireRole(...WRITE_ROLES);

const CATEGORIES = ['electrical', 'plumbing', 'hvac', 'furniture', 'it', 'cleaning', 'general'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

const orderSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.enum(CATEGORIES).default('general'),
  priority: z.enum(PRIORITIES).default('medium'),
  unitId: z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  ticketId: z.string().optional().nullable(),
  cost: z.number().nonnegative().optional().nullable(),
  scheduledAt: z.coerce.date().optional().nullable(),
});
const orderUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    category: z.enum(CATEGORIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(STATUSES).optional(),
    unitId: z.string().optional().nullable(),
    assignedToId: z.string().optional().nullable(),
    cost: z.number().nonnegative().optional().nullable(),
    scheduledAt: z.coerce.date().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

const includeOrder = {
  unit: { select: { id: true, code: true } },
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

async function nextOrderNumber(tenantId) {
  const last = await prisma.maintenanceOrder.findFirst({
    where: { tenantId },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  return (last?.orderNumber || 0) + 1;
}

router.get('/', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.assignedToId) where.assignedToId = String(req.query.assignedToId);
    const orders = await prisma.maintenanceOrder.findMany({
      where,
      include: includeOrder,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ orders });
  } catch (e) { next(e); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    const [pending, inProgress] = await Promise.all([
      prisma.maintenanceOrder.count({ where: { ...where, status: 'pending' } }),
      prisma.maintenanceOrder.count({ where: { ...where, status: 'in_progress' } }),
    ]);
    const totalCost = await prisma.maintenanceOrder.aggregate({
      where: { ...where, status: 'completed' },
      _sum: { cost: true },
    });
    res.json({ stats: { pending, inProgress, totalCost: Number(totalCost._sum.cost || 0) } });
  } catch (e) { next(e); }
});

router.post('/', write, validateBody(orderSchema), async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const order = await prisma.maintenanceOrder.create({
      data: { ...req.body, tenantId, orderNumber: await nextOrderNumber(tenantId), createdById: req.user.id },
      include: includeOrder,
    });
    await writeAudit(req, 'maintenance.create', 'MaintenanceOrder', order.id, null, { title: order.title });
    res.status(201).json({ order });
  } catch (e) { next(e); }
});

router.patch('/:id', write, validateBody(orderUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.maintenanceOrder.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    const data = { ...req.body };
    if (data.status === 'completed' && existing.status !== 'completed') data.completedAt = new Date();
    const order = await prisma.maintenanceOrder.update({
      where: { id: req.params.id },
      data,
      include: includeOrder,
    });
    await writeAudit(req, 'maintenance.update', 'MaintenanceOrder', order.id, { status: existing.status }, { status: order.status });
    res.json({ order });
  } catch (e) { next(e); }
});

router.delete('/:id', write, async (req, res, next) => {
  try {
    const order = await prisma.maintenanceOrder.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await prisma.maintenanceOrder.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
