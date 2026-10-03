// Phase 46 Track 1: Currency Settings API.
// Coordinator: mount with app.use('/api/currency-settings', require('./routes/currency-settings'));
// Sidebar link: Settings section -> { label: 'Currency', path: '/settings/currency' } (roles: ceo/admin).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin'));

// Curated ISO-4217 list (most-used by coworking tenants; extend as needed)
const CURRENCIES = {
  PKR: 'Pakistani Rupee', USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound',
  AED: 'UAE Dirham', SAR: 'Saudi Riyal', QAR: 'Qatari Riyal', KWD: 'Kuwaiti Dinar',
  BHD: 'Bahraini Dinar', OMR: 'Omani Rial', INR: 'Indian Rupee', BDT: 'Bangladeshi Taka',
  CNY: 'Chinese Yuan', JPY: 'Japanese Yen', AUD: 'Australian Dollar', CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc', SGD: 'Singapore Dollar', MYR: 'Malaysian Ringgit', TRY: 'Turkish Lira',
  EGP: 'Egyptian Pound', NGN: 'Nigerian Naira', KES: 'Kenyan Shilling', ZAR: 'South African Rand',
};

const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO-4217 code')
  .refine((c) => !!CURRENCIES[c], (c) => ({ message: `Unsupported currency: ${c}` }));

const settingsSchema = z.object({
  baseCurrency: currencyCode.default('PKR'),
  enabledCurrencies: z.array(currencyCode).min(1).max(10).default(['PKR']),
  defaultInvoiceCurrency: currencyCode.optional().nullable(),
  fxSource: z.enum(['manual', 'auto']).default('manual'),
}).superRefine((data, ctx) => {
  if (!data.enabledCurrencies.includes(data.baseCurrency)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['enabledCurrencies'], message: 'Base currency must be in the enabled list' });
  }
  if (data.defaultInvoiceCurrency && !data.enabledCurrencies.includes(data.defaultInvoiceCurrency)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultInvoiceCurrency'], message: 'Default invoice currency must be enabled' });
  }
});

// Merge se pehle graceful 503 (koi 500 crash nahi)
router.use((req, res, next) => {
  if (!prisma.currencySetting) return res.status(503).json({ error: 'Currency settings not migrated yet' });
  next();
});

router.get('/', async (req, res, next) => {
  try {
    const s = await prisma.currencySetting.findUnique({ where: { tenantId: req.user.tenantId } });
    res.json({ settings: s, currencies: CURRENCIES });
  } catch (e) { next(e); }
});

router.put('/', validateBody(settingsSchema), async (req, res, next) => {
  try {
    const { baseCurrency, enabledCurrencies, defaultInvoiceCurrency, fxSource } = req.body;
    const s = await prisma.currencySetting.upsert({
      where: { tenantId: req.user.tenantId },
      create: { tenantId: req.user.tenantId, baseCurrency, enabledCurrencies, defaultInvoiceCurrency: defaultInvoiceCurrency || null, fxSource },
      update: { baseCurrency, enabledCurrencies, defaultInvoiceCurrency: defaultInvoiceCurrency || null, fxSource },
    });
    res.json({ settings: s });
  } catch (e) { next(e); }
});

module.exports = router;
