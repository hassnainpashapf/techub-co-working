// Phase 55 Track 5: Concierge Service Billing API.
// COORDINATOR (additive, server.js untouched by this track):
//   app.use('/api/concierge-billing', require('./routes/concierge-billing'));
// Sidebar link NAHI — concierge requests page extend hai (integration note file ke akhir me).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { billRequest, unbilledRequests } = require('../lib/conciergeBilling');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF);

function billingEnabled() {
  return !!(prisma && prisma.serviceRequest && prisma.invoice);
}
function guard503(req, res, next) {
  if (!billingEnabled()) return res.status(503).json({ error: 'Concierge billing schema pending migration' });
  next();
}
router.use(guard503);

// GET /api/concierge-billing/unbilled — completed requests jin par abhi invoice nahi bana.
router.get('/unbilled', staffOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const items = await unbilledRequests(tf.tenantId, { limit });
    return res.json({ items, count: items.length });
  } catch (err) { return next(err); }
});

// POST /api/concierge-billing/:requestId/bill — request se draft invoice.
const billSchema = z.object({
  amount: z.number().positive().optional(), // default: request.price
  dueDate: z.string().optional(),
});
router.post('/:requestId/bill', staffOnly, validateBody(billSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { invoice, alreadyBilled } = await billRequest(tf.tenantId, req.params.requestId, req.body);
    writeAudit(req, tf, 'concierge.request_billed', invoice.id, {
      requestId: req.params.requestId,
      amount: Number(invoice.amount),
      number: invoice.number,
      alreadyBilled,
    });
    return res.status(alreadyBilled ? 200 : 201).json({
      invoice: { id: invoice.id, number: invoice.number, amount: Number(invoice.amount), status: invoice.status },
      alreadyBilled,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Billing failed' });
  }
});

module.exports = router;

// INTEGRATION NOTE (coordinator / concierge requests page owner):
// `apps/web/app/(app)/concierge/requests/page.js` me done/completed request ki row par
// "🧾 Bill" button lagayein: POST /api/concierge-billing/:id/bill → 201 {invoice}
// (200 + alreadyBilled:true agar pehle se billed ho). Unbilled queue:
// GET /api/concierge-billing/unbilled → "Unbilled requests (N)" badge.
