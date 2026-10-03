// Phase 46 Track 5: FX Gain/Loss Tracking — API.
//
// Mount (coordinator, server.js me — additive):
//   app.use('/api/fx-gainloss', require('./routes/fx-gainloss'));
// Sidebar link: nahi — finance extend hai (finance/billing section me "FX Gain/Loss" link/tab).
//
// Schema dependency: `FxGainLoss` model
// (fragment: apps/api/prisma/fragments/fx-gainloss.prisma) — merge se pehle 503 guard.
//
// INTEGRATION NOTE — payments allocation (coordinator kare, owner: phase 46 track 4):
//   payment allocate hone ke baad fire-and-forget:
//     const { recordFxGainLoss } = require('../lib/fxGainLoss');
//     recordFxGainLoss({
//       tenantId: tf.tenantId,
//       paymentId: payment.id,
//       invoiceId: payment.invoiceId,
//       settledAmountInvCur: <invoice currency me settle hui raqam>,
//       actorId: req.user?.sub || null,
//     }).catch(() => {});
//   (payment currency == invoice currency ho to settledAmountInvCur = payment.amount)
//
// P&L NOTE — pnl.js (coordinator, optional): revenue me `fxGainLoss` net gains jorne ke liye
//   `GET /api/fx-gainloss/summary` ka `totalGains` use karein (koi Income model nahi hai).

const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { recordFxGainLoss, schemaReady } = require('../lib/fxGainLoss');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const FINANCE_ROLES = ['ceo', 'admin', 'super_admin', 'finance'];
const financeOnly = requireRole(...FINANCE_ROLES);
router.use(financeOnly);

// Schema merge hui ya nahi — safe guard (koi 500 crash nahi)
function guard(req, res, next) {
  if (!schemaReady()) return res.status(503).json({ ok: false, error: 'fx_gain_loss_not_migrated' });
  return next();
}
router.use(guard);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// GET /api/fx-gainloss — list (?invoiceId= ?reason= ?from= ?to= ?limit=)
router.get('/', async (req, res) => {
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.invoiceId) where.invoiceId = String(req.query.invoiceId);
  if (req.query.reason) where.reason = String(req.query.reason);
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.gte = new Date(req.query.from);
    if (req.query.to) where.createdAt.lte = new Date(req.query.to);
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const rows = await prisma.fxGainLoss.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      invoice: { select: { id: true, number: true } },
      payment: { select: { id: true, receiptNo: true, amount: true } },
    },
  });
  return res.json({
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoice?.number || null,
      paymentId: r.paymentId,
      receiptNo: r.payment?.receiptNo || null,
      amount: num(r.amount),
      kind: num(r.amount) >= 0 ? 'gain' : 'loss',
      reason: r.reason,
      expenseId: r.expenseId,
      bookedAsExpense: !!r.expenseId,
      createdAt: r.createdAt,
    })),
  });
});

// GET /api/fx-gainloss/summary — totals (gains, losses, net)
router.get('/summary', async (req, res) => {
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.gte = new Date(req.query.from);
    if (req.query.to) where.createdAt.lte = new Date(req.query.to);
  }
  const rows = await prisma.fxGainLoss.findMany({ where, select: { amount: true } });
  let totalGains = 0;
  let totalLosses = 0;
  for (const r of rows) {
    const a = num(r.amount);
    if (a >= 0) totalGains += a;
    else totalLosses += Math.abs(a);
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  return res.json({
    ok: true,
    count: rows.length,
    totalGains: r2(totalGains),
    totalLosses: r2(totalLosses),
    net: r2(totalGains - totalLosses),
    note: 'Losses auto-booked as approved expenses (category: other). No Income model exists, so gains appear here only — see P&L integration note.',
  });
});

// POST /api/fx-gainloss/recompute/:paymentId — ek payment ke liye dobara compute
router.post('/recompute/:paymentId', async (req, res) => {
  const tf = tenantFilter(req);
  const payment = await prisma.payment.findFirst({
    where: { id: req.params.paymentId, ...tf },
    select: { id: true, invoiceId: true, amount: true },
  });
  if (!payment) return res.status(404).json({ ok: false, error: 'payment_not_found' });
  // Same-currency case: settled amount = payment amount. Cross-currency ke liye
  // caller ko settledAmountInvCur body me dena hoga.
  const settled = req.body && req.body.settledAmountInvCur != null
    ? num(req.body.settledAmountInvCur)
    : num(payment.amount);
  const result = await recordFxGainLoss({
    tenantId: tf.tenantId,
    paymentId: payment.id,
    invoiceId: payment.invoiceId,
    settledAmountInvCur: settled,
    actorId: req.user?.sub || null,
  });
  if (!result.ok) return res.status(422).json({ ok: false, ...result });
  return res.json({ ok: true, ...result });
});

module.exports = router;
