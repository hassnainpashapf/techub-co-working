// Phase 29 Track 5: Inventory low-stock alerts.
// checkLowStock(tenantId, itemId?) — items with quantity <= reorderLevel.
// Notifies ceo/admin/manager (via Notification.role targeting) once per item
// per cooldown window, and returns the low-stock list.
const prisma = require('./prisma');

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // one alert per item per day
const recentAlerts = new Map(); // key: `${tenantId}:${itemId}` -> timestamp

const ALERT_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'operations_manager'];

function alertKey(tenantId, itemId) {
  return `${tenantId}:${itemId}`;
}

function canAlert(tenantId, itemId) {
  const last = recentAlerts.get(alertKey(tenantId, itemId));
  return !last || Date.now() - last > ALERT_COOLDOWN_MS;
}

function markAlerted(tenantId, itemId) {
  recentAlerts.set(alertKey(tenantId, itemId), Date.now());
  // Bound the map size
  if (recentAlerts.size > 2000) {
    const oldest = [...recentAlerts.entries()].sort((a, b) => a[1] - b[1])[0];
    recentAlerts.delete(oldest[0]);
  }
}

async function getLowStock(tenantId, itemId) {
  const where = { tenantId };
  if (itemId) where.id = itemId;
  const items = await prisma.inventoryItem.findMany({ where, orderBy: { quantity: 'asc' } });
  return items.filter((i) => i.quantity <= (i.reorderLevel || 0));
}

async function checkLowStock(tenantId, itemId) {
  const low = await getLowStock(tenantId, itemId);
  const fresh = low.filter((i) => canAlert(tenantId, i.id));
  if (fresh.length) {
    // One notification row per role — Notification.role targets every active
    // user with that role in the tenant.
    const message =
      fresh.length === 1
        ? `⚠️ Low stock: "${fresh[0].name}" — ${fresh[0].quantity} ${fresh[0].unit} left (reorder at ${fresh[0].reorderLevel}).`
        : `⚠️ ${fresh.length} inventory items are low on stock (at or below reorder level).`;
    await prisma.notification.createMany({
      data: ALERT_ROLES.map((role) => ({
        tenantId,
        role,
        type: 'general',
        message,
      })),
    });
    fresh.forEach((i) => markAlerted(tenantId, i.id));
  }
  return low;
}

module.exports = { checkLowStock, getLowStock, ALERT_COOLDOWN_MS };
