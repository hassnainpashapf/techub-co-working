// Phase 34 Track 2: Asset Management API.
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

const ASSET_ROLES = ['ceo', 'admin', 'manager', 'operations_manager', 'office_boy', 'super_admin'];
const write = requireRole(...ASSET_ROLES);
const read = requireRole(...ASSET_ROLES);

const CATEGORIES = ['furniture', 'it', 'av', 'other'];
const STATUSES = ['available', 'in_use', 'maintenance', 'retired'];

const assetSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(CATEGORIES).default('other'),
  serialNumber: z.string().max(80).optional().nullable(),
  purchaseDate: z.coerce.date().optional().nullable(),
  value: z.number().nonnegative().optional().nullable(),
  location: z.string().max(120).optional().nullable(),
});

const checkoutSchema = z.object({
  memberId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
});

const includeCheckout = {
  checkouts: {
    orderBy: { checkedOutAt: 'desc' },
    take: 5,
    include: {
      member: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  },
};

// GET /api/assets — list with filters
router.get('/', read, async (req, res) => {
  const { status, category } = req.query;
  const where = { ...tenantFilter(req) };
  if (status && STATUSES.includes(status)) where.status = status;
  if (category && CATEGORIES.includes(category)) where.category = category;
  const [items, counts] = await Promise.all([
    prisma.facilityAsset.findMany({ where, include: includeCheckout, orderBy: { createdAt: 'desc' } }),
    prisma.facilityAsset.groupBy({ by: ['status'], where: tenantFilter(req), _count: { _all: true } }),
  ]);
  const summary = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const c of counts) summary[c.status] = c._count._all;
  res.json({ items, summary });
});

// POST /api/assets — add asset
router.post('/', write, validateBody(assetSchema), async (req, res) => {
  const asset = await prisma.facilityAsset.create({
    data: { ...tenantFilter(req), ...req.validated },
  });
  writeAudit({
    tenantId: req.tenantId,
    actorId: req.user?.sub,
    action: 'asset.create',
    entity: 'Asset',
    entityId: asset.id,
    newValue: asset,
  }).catch(() => {});
  res.status(201).json(asset);
});

// POST /api/assets/:id/checkout
router.post('/:id/checkout', write, validateBody(checkoutSchema), async (req, res) => {
  const { memberId, userId, dueAt } = req.validated;
  const asset = await prisma.facilityAsset.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
  });
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.status !== 'available')
    return res.status(409).json({ error: `Asset is ${asset.status}, cannot check out` });

  if (memberId) {
    const m = await prisma.member.findFirst({ where: { id: memberId, ...tenantFilter(req) } });
    if (!m) return res.status(400).json({ error: 'Member not found' });
  }
  if (userId) {
    const u = await prisma.user.findFirst({ where: { id: userId } });
    if (!u) return res.status(400).json({ error: 'User not found' });
  }

  const result = await prisma.$transaction(async (tx) => {
    const checkout = await tx.facilityAssetCheckout.create({
      data: {
        assetId: asset.id,
        tenantId: asset.tenantId,
        memberId: memberId || null,
        userId: userId || null,
        dueAt: dueAt || null,
      },
    });
    const updated = await tx.facilityAsset.update({
      where: { id: asset.id },
      data: { status: 'in_use' },
    });
    return { checkout, updated };
  });

  writeAudit({
    tenantId: req.tenantId,
    actorId: req.user?.sub,
    action: 'asset.checkout',
    entity: 'Asset',
    entityId: asset.id,
    oldValue: { status: 'available' },
    newValue: { status: 'in_use', memberId, userId, dueAt },
  }).catch(() => {});
  res.status(201).json(result);
});

// POST /api/assets/:id/return
router.post(
  '/:id/return',
  write,
  validateBody(z.object({ condition: z.string().max(500).optional().nullable() })),
  async (req, res) => {
    const asset = await prisma.facilityAsset.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
      include: { checkouts: { where: { returnedAt: null }, orderBy: { checkedOutAt: 'desc' }, take: 1 } },
    });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (asset.status !== 'in_use' || !asset.checkouts.length)
      return res.status(409).json({ error: 'Asset is not checked out' });

    const open = asset.checkouts[0];
    const result = await prisma.$transaction(async (tx) => {
      const checkout = await tx.facilityAssetCheckout.update({
        where: { id: open.id },
        data: { returnedAt: new Date(), condition: req.validated.condition || null },
      });
      const updated = await tx.facilityAsset.update({
        where: { id: asset.id },
        data: { status: 'available' },
      });
      return { checkout, updated };
    });

    writeAudit({
      tenantId: req.tenantId,
      actorId: req.user?.sub,
      action: 'asset.return',
      entity: 'Asset',
      entityId: asset.id,
      oldValue: { status: 'in_use' },
      newValue: { status: 'available', condition: req.validated.condition },
    }).catch(() => {});
    res.json(result);
  }
);

// POST /api/assets/:id/maintenance — toggle available <-> maintenance
router.post('/:id/maintenance', write, async (req, res) => {
  const asset = await prisma.facilityAsset.findFirst({
    where: { id: req.params.id, ...tenantFilter(req) },
  });
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.status === 'in_use')
    return res.status(409).json({ error: 'Checked-out asset cannot go to maintenance' });
  const next = asset.status === 'maintenance' ? 'available' : 'maintenance';
  const updated = await prisma.facilityAsset.update({ where: { id: asset.id }, data: { status: next } });
  writeAudit({
    tenantId: req.tenantId,
    actorId: req.user?.sub,
    action: 'asset.maintenance',
    entity: 'Asset',
    entityId: asset.id,
    oldValue: { status: asset.status },
    newValue: { status: next },
  }).catch(() => {});
  res.json(updated);
});

// PATCH /api/assets/:id — edit (ceo/admin/manager)
router.patch(
  '/:id',
  requireRole('ceo', 'admin', 'manager', 'super_admin'),
  validateBody(
    assetSchema.partial().extend({ status: z.enum(['available', 'retired']).optional() })
  ),
  async (req, res) => {
    const existing = await prisma.facilityAsset.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    const updated = await prisma.facilityAsset.update({ where: { id: existing.id }, data: req.validated });
    writeAudit({
      tenantId: req.tenantId,
      actorId: req.user?.sub,
      action: 'asset.update',
      entity: 'Asset',
      entityId: existing.id,
      oldValue: existing,
      newValue: updated,
    }).catch(() => {});
    res.json(updated);
  }
);

module.exports = router;
