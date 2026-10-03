// Phase 43 Track 4: Order Payment & Billing API.
// IMPORTANT: food-orders.js ko nahi chhera (Track 2 parallel me kaam kar raha
// hai) — yeh alag router hai jo '/api/food-orders' par mount hoga (Express
// multi-router pattern, event-checkins jaisa).
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/food-orders', require('./routes/food-payments'));
// SIDEBAR: nahi — cafe pages (kitchen / portal) extend hain.
// FRONTEND INTEGRATION (coordinator):
//   kitchen page + portal cafe page me order card par "Pay" button lagayein:
//   POST /api/food-orders/:id/pay { method: 'cash'|'card'|'wallet'|'invoice' }
//   -> 200 { order, invoice? } | 409 (already paid) | 422 (wallet/cancelled) | 503 (migration pending)
const express = require('express');
const { z } = require('zod');

const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { settleOrder, PAY_METHODS } = require('../lib/foodBilling');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const payOnly = requireRole('ceo', 'admin', 'super_admin', 'manager', 'finance', 'receptionist', 'operations_manager');

const paySchema = z.object({
  method: z.enum(PAY_METHODS),
});

router.post('/:id/pay', payOnly, validateBody(paySchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const result = await settleOrder({
      tenantId: tf.tenantId,
      orderId: req.params.id,
      method: req.body.method,
      actorId: req.user.sub,
    });
    if (!result.ok) {
      return res.status(result.code || 400).json({
        error: result.error,
        ...(result.detail ? { detail: result.detail } : {}),
      });
    }
    const out = { order: result.order };
    if (result.invoice) out.invoice = { id: result.invoice.id, number: result.invoice.number, amount: result.invoice.amount };
    if (result.walletBalance !== undefined) out.walletBalance = result.walletBalance;
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
