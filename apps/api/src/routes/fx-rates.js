// Phase 46 Track 2: FX rates API.
// Mount (coordinator): app.use('/api/fx-rates', require('./routes/fx-rates'));
// Sidebar link nahi — Track 1 (currency settings) ki page me "Exchange Rates" tab ke tor par
// surface hoga (GET /latest se rate calculator + GET / se history).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { tenantFilter } = require('../lib/tenant');
const { getRate, convert, setManualRate, refreshAutoRates, normalizeCurrency, getBaseCurrency } = require('../lib/fx');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'manager'));

// Model missing before merge → 503, not 500
router.use((req, res, next) => {
  if (!prisma.fxRate) return res.status(503).json({ error: 'fx rates schema not migrated yet' });
  next();
});

const currencyCode = z.string().trim().regex(/^[A-Za-z]{3}$/, 'must be ISO-4217 (3 letters)');

// GET /latest?from=USD&to=PKR — single rate lookup (rate calculator ke liye)
router.get('/latest', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const from = normalizeCurrency(req.query.from);
    const to = normalizeCurrency(req.query.to);
    const r = await getRate(tf.tenantId, from, to);
    res.json({ from, to, ...r, effectiveDate: r.effectiveDate });
  } catch (e) {
    if (e.code === 'FX_RATE_MISSING' || e.code === 'INVALID_CURRENCY' || e.code === 'FX_NOT_MIGRATED') {
      return res.status(404).json({ error: e.message, code: e.code, details: e.details || null });
    }
    next(e);
  }
});

// GET /convert?amount=100&from=USD&to=PKR — amount conversion
router.get('/convert', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const amount = Number(req.query.amount);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'amount must be a non-negative number' });
    const from = normalizeCurrency(req.query.from);
    const to = normalizeCurrency(req.query.to);
    const converted = await convert(amount, tf.tenantId, from, to);
    const r = await getRate(tf.tenantId, from, to);
    res.json({ amount, from, to, converted, rate: r.rate, source: r.source });
  } catch (e) {
    if (e.code === 'FX_RATE_MISSING' || e.code === 'INVALID_CURRENCY' || e.code === 'FX_NOT_MIGRATED') {
      return res.status(404).json({ error: e.message, code: e.code, details: e.details || null });
    }
    next(e);
  }
});

// GET / — rate history (?from=&to=&from_date=&to_date=&limit=)
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { tenantId: tf.tenantId };
    if (req.query.from) where.fromCurrency = normalizeCurrency(req.query.from);
    if (req.query.to) where.toCurrency = normalizeCurrency(req.query.to);
    if (req.query.from_date || req.query.to_date) {
      where.effectiveDate = {};
      if (req.query.from_date) where.effectiveDate.gte = new Date(req.query.from_date);
      if (req.query.to_date) where.effectiveDate.lte = new Date(req.query.to_date);
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const [rates, total] = await Promise.all([
      prisma.fxRate.findMany({ where, orderBy: { effectiveDate: 'desc' }, take: limit }),
      prisma.fxRate.count({ where }),
    ]);
    const baseCurrency = await getBaseCurrency(tf.tenantId);
    res.json({ rates, total, baseCurrency });
  } catch (e) { next(e); }
});

// POST / — manual rate set ({fromCurrency, toCurrency, rate, effectiveDate?})
router.post('/', validateBody(z.object({
  fromCurrency: currencyCode,
  toCurrency: currencyCode,
  rate: z.number().positive().max(1e12),
  effectiveDate: z.string().datetime({ offset: true }).optional().nullable(),
})), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { fromCurrency, toCurrency, rate, effectiveDate } = req.body;
    const row = await setManualRate(tf.tenantId, fromCurrency, toCurrency, rate, {
      effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
    });
    await writeAudit(req, { action: 'fx_rate.set', entity: 'FxRate', entityId: row.id, newValue: { from: row.fromCurrency, to: row.toCurrency, rate: row.rate.toString() } }).catch(() => {});
    res.status(201).json({ rate: row });
  } catch (e) {
    if (e.code === 'INVALID_CURRENCY' || e.code === 'INVALID_CURRENCY_PAIR' || e.code === 'INVALID_RATE') {
      return res.status(422).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});

// POST /refresh — auto-update abhi chalao (fail-safe, free endpoint, koi credentials nahi)
router.post('/refresh', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const out = await refreshAutoRates(tf.tenantId);
    res.json({ refreshed: true, ...out });
  } catch (e) { next(e); }
});

// DELETE /:id — ek rate entry hatao (audit me rehta hai)
router.delete('/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const row = await prisma.fxRate.findFirst({ where: { id: req.params.id, tenantId: tf.tenantId } });
    if (!row) return res.status(404).json({ error: 'rate not found' });
    await prisma.fxRate.delete({ where: { id: row.id } });
    await writeAudit(req, { action: 'fx_rate.delete', entity: 'FxRate', entityId: row.id, oldValue: { from: row.fromCurrency, to: row.toCurrency } }).catch(() => {});
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
