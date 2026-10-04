// Phase 56 Track 3: Locker Billing API.
// COORDINATOR (additive, server.js untouched by this track):
//   app.use('/api/locker-billing', require('./routes/locker-billing'));
// Job wiring (server.js, additive):
//   require('./lib/lockerBilling') — coordinator daily job me loop kare:
//   const { runLockerBilling } = require('./lib/lockerBilling');
//   // sab tenants: prisma.tenant.findMany() -> har ek par runLockerBilling(tenantId)
// Sidebar link NAHI — lockers page extend hai.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { runLockerBilling, unbilledRentals } = require('../lib/lockerBilling');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

function billingEnabled() {
  return !!(prisma && prisma.lockerRental && prisma.invoice);
}
function guard503(req, res, next) {
  if (!billingEnabled()) return res.status(503).json({ error: 'Locker billing schema pending migration' });
  next();
}
router.use(guard503);

// GET /api/locker-billing/unbilled — due cycles jin par abhi invoice nahi bana.
router.get('/unbilled', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const items = await unbilledRentals(tf.tenantId, { limit });
    return res.json({ items, count: items.length });
  } catch (err) { return next(err); }
});

// POST /api/locker-billing/run — manual billing run (sab active tenants ya ek tenant).
const runSchema = z.object({
  tenantId: z.string().optional(),
  dryRun: z.boolean().optional(),
});
router.post('/run', staffOnly, validateBody(runSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { dryRun } = req.body;
    let tenantIds;
    if (req.body.tenantId) {
      tenantIds = [req.body.tenantId];
    } else if (req.user && req.user.role === 'super_admin') {
      // Super admin: sab active tenants (Track 1 model absent ho to guarded).
      const tenants = await prisma.tenant.findMany({ select: { id: true }, take: 500 });
      tenantIds = tenants.map((t) => t.id);
    } else {
      tenantIds = [tf.tenantId];
    }
    const results = [];
    for (const tid of tenantIds) {
      const stats = await runLockerBilling(tid, { dryRun: !!dryRun });
      results.push({ tenantId: tid, ...stats });
    }
    const total = results.reduce(
      (a, r) => ({ billed: a.billed + r.billed, alreadyBilled: a.alreadyBilled + r.alreadyBilled, skipped: a.skipped + r.skipped }),
      { billed: 0, alreadyBilled: 0, skipped: 0 }
    );
    writeAudit(req, tf, 'locker.billing_run', null, { ...total, dryRun: !!dryRun, tenants: tenantIds.length });
    return res.json({ total, results, dryRun: !!dryRun });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Billing run failed' });
  }
});

module.exports = router;

// INTEGRATION NOTE (coordinator / lockers page owner):
// Lockers page par "💳 Run billing" button: POST /api/locker-billing/run {dryRun:true} pehle
// → preview dikhayein, phir confirm par {dryRun:false}.
// Unbilled queue: GET /api/locker-billing/unbilled → "Unbilled rentals (N)" badge.
// Model LockerRental Track 1 (locker-units fragment) se ayega — merge se pehle 503.
