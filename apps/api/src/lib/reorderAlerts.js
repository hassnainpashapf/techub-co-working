// Phase 41 Track 7: Inventory reorder alerts — daily job.
//
// Kya karta hai: roz subah tamam active tenants scan karta hai; jiss InventoryItem
// ki quantity <= reorderLevel hai us par:
//   1. staff roles (ceo/admin/super_admin/manager/operations_manager) ko notification
//      + frontend quick link "/procurement/purchase-orders?prefill=<itemId>"
//   2. agar PurchaseOrder model merged hai aur iss item ki pichli purchase ka vendor
//      mil jata hai to ek **draft PO** pre-filled bana deta hai (vendor + line item).
// Dedupe: har item par din me max 1 notification (in-memory cooldown, inventoryAlerts wala pattern).
//
// Migration pending ho (lastRestockedAt column na ho) to gracefully degrade hota hai —
// alerts reorderLevel/quantity par chalte hain, column par nahi.
//
// Coordinator wiring (server.js, additive):
//   require('./lib/reorderAlerts');
//   require('./lib/reorderAlerts').ensureReorderAlertsScheduled();
//
// Inventory movement "in" hook (coordinator, inventory.js me additive):
//   try { await require('../lib/reorderAlerts').touchRestockedAt(itemId); } catch {}
const prisma = require('./prisma');

const ALERT_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'operations_manager'];
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const recentAlerts = new Map(); // `${tenantId}:${itemId}` -> ts

function canAlert(tenantId, itemId) {
  const last = recentAlerts.get(`${tenantId}:${itemId}`);
  return !last || Date.now() - last > COOLDOWN_MS;
}
function markAlerted(tenantId, itemId) {
  recentAlerts.set(`${tenantId}:${itemId}`, Date.now());
  if (recentAlerts.size > 2000) {
    const oldest = [...recentAlerts.entries()].sort((a, b) => a[1] - b[1])[0];
    recentAlerts.delete(oldest[0]);
  }
}

// Stock "in" movement par lastRestockedAt set karo (migration na ho to silently skip).
async function touchRestockedAt(itemId) {
  try {
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { lastRestockedAt: new Date() },
    });
  } catch (e) {
    if (!/Unknown argument|lastRestockedAt/i.test(e.message)) throw e;
  }
}

// Pichli purchase ka vendor dhoondo: sab se recent PO jiss ki items me ye item name ho.
async function lastPurchaseVendorId(tenantId, itemName) {
  try {
    if (!prisma.purchaseOrder) return null;
    const needle = String(itemName || '').toLowerCase();
    if (!needle) return null;
    const pos = await prisma.purchaseOrder.findMany({
      where: { tenantId, status: { notIn: ['rejected'] } },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { vendorId: true, items: true },
    });
    for (const po of pos) {
      const items = Array.isArray(po.items) ? po.items : [];
      if (items.some((it) => String(it.desc || it.name || '').toLowerCase().includes(needle))) {
        return po.vendorId;
      }
    }
  } catch { /* PurchaseOrder merge na hua ho to skip */ }
  return null;
}

// PO-YYYYMM-NNNN number generate karo (per tenant unique).
async function nextPONumber(tenantId) {
  const d = new Date();
  const prefix = `PO-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-`;
  const count = await prisma.purchaseOrder.count({
    where: { tenantId, number: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

// Reorder draft PO banao — vendor milna LAZMI hai (vendorId required hai), warna null.
async function createReorderPO(tenantId, item, userId) {
  try {
    if (!prisma.purchaseOrder) return null;
    const vendorId = await lastPurchaseVendorId(tenantId, item.name);
    if (!vendorId) return null;
    const qty = Math.max((item.reorderLevel || 5) * 2 - (item.quantity || 0), 1);
    const po = await prisma.purchaseOrder.create({
      data: {
        tenantId,
        number: await nextPONumber(tenantId),
        vendorId,
        items: [{ desc: item.name, qty, price: item.unitPrice ? Number(item.unitPrice) : 0 }],
        status: 'draft',
        requestedBy: userId || null,
      },
    });
    return po;
  } catch (e) {
    console.error('[reorder-alerts] draft PO failed:', e.message);
    return null;
  }
}

async function processTenantReorderAlerts(tenantId) {
  let getLowStock;
  try {
    ({ getLowStock } = require('./inventoryAlerts'));
  } catch {
    return { items: [], notified: 0 };
  }
  const low = await getLowStock(tenantId);
  const fresh = low.filter((i) => canAlert(tenantId, i.id));
  let notified = 0;
  for (const item of fresh) {
    // "Create PO" quick link + optional pre-filled draft PO
    const draftPO = await createReorderPO(tenantId, item, null);
    const poLine = draftPO
      ? ` Draft PO ${draftPO.number} tayyar hai.`
      : ` PO banane ke liye yahan jayein: /procurement/purchase-orders?prefill=${item.id}`;
    try {
      await prisma.notification.createMany({
        data: ALERT_ROLES.map((role) => ({
          tenantId,
          role,
          type: 'general',
          message: `⚠️ Low stock: "${item.name}" — ${item.quantity} ${item.unit} left (reorder at ${item.reorderLevel}).${poLine}`,
        })),
      });
      notified += 1;
    } catch (e) {
      console.error('[reorder-alerts] notify failed:', e.message);
    }
    markAlerted(tenantId, item.id);
  }
  return { items: low.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, reorderLevel: i.reorderLevel })), notified };
}

async function processReorderAlerts() {
  const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } })
    .catch(() => []);
  const out = [];
  for (const t of tenants) {
    try {
      out.push({ tenantId: t.id, ...(await processTenantReorderAlerts(t.id)) });
    } catch (e) {
      console.error('[reorder-alerts] tenant failed:', t.id, e.message);
    }
  }
  // Self-reschedule (docExpiryJob pattern)
  await ensureReorderAlertsScheduled();
  return out;
}

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

async function ensureReorderAlertsScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs || typeof jobs.enqueue !== 'function') return;
    const pending = await prisma.job.count({ where: { type: 'reorder-alerts', status: 'pending' } }).catch(() => 1);
    if (pending === 0) {
      const morning = new Date();
      morning.setHours(7, 0, 0, 0);
      if (morning.getTime() < Date.now()) morning.setDate(morning.getDate() + 1);
      await jobs.enqueue('reorder-alerts', {}, { runAt: morning });
    }
  } catch (e) {
    console.error('[reorder-alerts] ensure schedule failed:', e.message);
  }
}

(async () => {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('reorder-alerts', processReorderAlerts);
    }
  } catch { /* coordinator merge karega */ }
})();

module.exports = {
  processReorderAlerts,
  processTenantReorderAlerts,
  ensureReorderAlertsScheduled,
  touchRestockedAt,
  createReorderPO,
};
