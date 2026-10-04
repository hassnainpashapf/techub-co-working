// Phase 56 Track 5: Rental Expiry & Renewal Alerts — API route.
// Mount (coordinator, server.js ADDITIVE — is file me server.js nahi chhua):
//   app.use('/api/locker-expiry', require('./routes/locker-expiry'));
// Job wiring (coordinator, server.js additive):
//   require('./lib/lockerExpiry').ensureLockerExpiryScheduled();
// Sidebar link nahi — storage/lockers section extend hai.
// Koi migration nahi — LockerRental/Locker Tracks 1+2 se aate hain.

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser, requireRole } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { checkExpiries } = require('../lib/lockerExpiry');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole(['ceo', 'admin']));

function lockerEnabled() {
  return !!(prisma && prisma.lockerRental);
}
function guard503(req, res, next) {
  if (!lockerEnabled()) return res.status(503).json({ error: 'Locker schema pending migration' });
  next();
}
router.use(guard503);

// POST /api/locker-expiry/scan — manual expiry scan (ceo/admin)
router.post('/scan', async (req, res) => {
  try {
    const result = await checkExpiries();
    const tf = { tenantId: req.user.tenantId };
    writeAudit({
      tenantId: tf.tenantId, actorId: req.user.sub, action: 'locker.expiry_scan',
      entity: 'LockerRental', entityId: null, newValue: result,
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[locker-expiry] scan failed:', e.message);
    res.status(500).json({ error: 'Scan failed' });
  }
});

module.exports = router;
