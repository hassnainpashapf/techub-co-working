// Phase 41 Track 7: Inventory reorder alerts API.
// Mount (server.js, additive — coordinator kare):
//   app.use('/api/inventory/reorder-alerts', require('./routes/reorder-alerts'));
//
// Endpoints:
//   GET  /            — low stock items (quantity <= reorderLevel), staff roles
//   POST /run         — manual daily-run trigger (write roles)
//   POST /:itemId/set-level {reorderLevel} — reorder level update (write roles) + audit
//
// ---- FRONTEND INTEGRATION NOTE (coordinator: inventory page me jorna) ----
// apps/web/app/(app)/inventory/page.js me per-item row par additive changes:
//   1. Low-stock badge: row ke naam ke paas dikhao jab i.quantity <= i.reorderLevel
//        {i.quantity <= i.reorderLevel && (
//          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">
//            Low stock
//          </span>
//        )}
//   2. Reorder level quick-edit: table me "Reorder at" column ke cell ko button banao;
//      click par prompt/modal se value le kar POST /api/inventory/reorder-alerts/:id/set-level
//      { reorderLevel } call karo, phir list refresh karo.
//   3. Last restocked: movement modal me "in" movement ke baad ya item detail me dikhao:
//        {i.lastRestockedAt && <div className="text-[11px] text-slate-500">
//          Last restocked: {new Date(i.lastRestockedAt).toLocaleDateString()}</div>}
//      (migration se pehle field null hota hai — optional chaining safe rakho)
// --------------------------------------------------------------------------
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

const READ_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'operations_manager'];
const WRITE_ROLES = ['ceo', 'admin', 'manager', 'operations_manager'];
const read = requireRole(...READ_ROLES);
const write = requireRole(...WRITE_ROLES);

const levelSchema = z.object({
  reorderLevel: z.number().int().min(0),
});

// GET / — low stock items
router.get('/', read, async (req, res, next) => {
  try {
    const { getLowStock } = require('../lib/inventoryAlerts');
    const items = await getLowStock(req.user.tenantId);
    res.json({
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        sku: i.sku,
        category: i.category,
        quantity: i.quantity,
        unit: i.unit,
        reorderLevel: i.reorderLevel,
        unitPrice: i.unitPrice ? Number(i.unitPrice) : null,
        lastRestockedAt: i.lastRestockedAt || null,
      })),
      count: items.length,
    });
  } catch (e) { next(e); }
});

// POST /run — manual trigger
router.post('/run', write, async (req, res, next) => {
  try {
    const { processTenantReorderAlerts } = require('../lib/reorderAlerts');
    const out = await processTenantReorderAlerts(req.user.tenantId);
    await writeAudit(req, 'inventory.reorder_alerts.run', 'Tenant', req.user.tenantId, null, { notified: out.notified });
    res.json({ ok: true, ...out });
  } catch (e) { next(e); }
});

// POST /:itemId/set-level — reorder level update
router.post('/:itemId/set-level', write, validateBody(levelSchema), async (req, res, next) => {
  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id: req.params.itemId, ...tenantFilter(req) },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const oldValue = { reorderLevel: item.reorderLevel };
    const updated = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { reorderLevel: req.body.reorderLevel },
    });
    await writeAudit(req, 'inventory.reorder_level.update', 'InventoryItem', item.id, oldValue, { reorderLevel: updated.reorderLevel });
    res.json({ ok: true, item: { id: updated.id, reorderLevel: updated.reorderLevel } });
  } catch (e) { next(e); }
});

module.exports = router;
