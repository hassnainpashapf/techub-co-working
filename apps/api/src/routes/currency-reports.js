// Phase 46 — multi-currency reports summary.
// Mount (coordinator, server.js me — additive):
//   app.use('/api/currency-reports', require('./routes/currency-reports'));
// Sidebar link: nahi — finance/reports extend hai.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { reportTotals, revenueTrend, arAging, getBaseCurrency } = require('../lib/currencyReports');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'manager', 'finance_officer'));

// GET /api/currency-reports/summary?from=&to=&currencyView=base|original
// Revenue + expense + outstanding ek jaga, base currency totals + per-currency breakdown.
router.get('/summary', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { from, to, currencyView } = req.query;
    const totals = await reportTotals(tf.tenantId, { from, to, currencyView });
    const [trend, aging] = await Promise.all([
      revenueTrend(tf.tenantId, 6, totals.currencyView),
      arAging(tf.tenantId, totals.currencyView),
    ]);
    res.json({
      ok: true,
      period: { from: from || null, to: to || null },
      ...totals,
      revenueTrend: trend.trend,
      arAging: aging,
    });
  } catch (err) { next(err); }
});

module.exports = router;
