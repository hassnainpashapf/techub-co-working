// Phase 46 Track 4: Multi-Currency Payments — helpers.
//
// COORDINATOR INTEGRATION (billing.js, POST /payments — additive patch):
//
// 1) paymentSchema me add karein:
//      currency: z.string().regex(/^[A-Z]{3}$/).optional().default('PKR'),
//
// 2) POST /payments handler me — `const { invoiceId, amount, method, paidAt, receiptNo, note } = req.body;`
//    ke baad (invoice fetch + proforma check ke baad):
//      const { snapshotPaymentCurrency, checkOverpay, finalizeAllocation } =
//        require('../lib/paymentCurrency');
//      const snap = await snapshotPaymentCurrency(req.user.tenantId, {
//        amount, currency: req.body.currency, paidAt: paidAt || new Date(),
//      });
//      // cross-currency remaining check (base currency me):
//      const over = await checkOverpay(req.user.tenantId, invoice, snap);
//      if (over.exceeds) return res.status(400).json({ error: { message: over.message } });
//      // ... existing transaction me payment create karte waqt data me jorein:
//      //   currency: snap.currency, fxRate: snap.fxRate, baseAmount: snap.baseAmount
//      // invoice update ke baad:
//      const alloc = await finalizeAllocation(req.user.tenantId, invoice.id);
//      // alloc.fullyPaid ho to status 'paid', warna 'partial' — rounding tolerance andar hai.
//
// 3) Receipt email (paymentReceived) me currency line — snippet file ke neeche
//    `receiptCurrencyLine()` me hai; mailer template ko { currencyLine } var dein.

const prisma = require('./prisma');

// Track 2 ka fx lib abhi merge na hua ho to graceful fallback (koi crash nahi)
function fxLib() {
  try {
    return require('./fx');
  } catch {
    return null;
  }
}

async function baseCurrency(tenantId) {
  try {
    const s = await prisma.currencySetting.findUnique({ where: { tenantId } });
    return s?.baseCurrency || 'PKR';
  } catch {
    return 'PKR';
  }
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Payment ke waqt FX snapshot: currency code normalize + fxRate + baseAmount.
 * - Same currency as base → fxRate 1
 * - fx lib/rate na mile → fxRate/baseAmount null (legacy same-currency mode)
 */
async function snapshotPaymentCurrency(tenantId, { amount, currency, paidAt }) {
  const code = String(currency || 'PKR').toUpperCase().trim();
  const base = await baseCurrency(tenantId);
  let fxRate = null;
  let baseAmount = null;
  if (code === base) {
    fxRate = 1;
    baseAmount = round2(amount);
  } else {
    const fx = fxLib();
    if (fx && typeof fx.getRate === 'function') {
      try {
        fxRate = Number(await fx.getRate(tenantId, code, base, paidAt || new Date()));
        if (Number.isFinite(fxRate) && fxRate > 0) {
          baseAmount = round2(Number(amount) * fxRate);
        } else {
          fxRate = null;
        }
      } catch {
        fxRate = null;
      }
    }
  }
  return { currency: code, baseCurrency: base, fxRate, baseAmount };
}

/** Invoice ka base-currency total/paid nikalna (Track 3 fields hon to use, warna raw). */
async function invoiceBaseFigures(tenantId, invoice) {
  const total = invoice.baseAmount != null ? Number(invoice.baseAmount) : Number(invoice.amount);
  let paid = 0;
  try {
    const payments = await prisma.payment.findMany({
      where: { invoiceId: invoice.id, tenantId },
      select: { amount: true, baseAmount: true },
    });
    paid = payments.reduce(
      (s, p) => s + (p.baseAmount != null ? Number(p.baseAmount) : Number(p.amount)),
      0
    );
  } catch {
    // merge pending → legacy amountPaid par fallback
    paid = Number(invoice.amountPaid || 0);
  }
  return { total: round2(total), paid: round2(paid), remaining: round2(total - paid) };
}

// Rounding tolerance: max(1 base unit, 0.5% of remaining) — FX conversion ka chhota farq
function toleranceFor(remainingBase) {
  return Math.max(1, round2(Math.abs(remainingBase) * 0.005));
}

/**
 * Overpay check (base currency me). Payment banne se PEHLE call karein.
 * Returns { exceeds, message, remainingBase, payBase }
 */
async function checkOverpay(tenantId, invoice, snap) {
  const { remaining } = await invoiceBaseFigures(tenantId, invoice);
  const payBase = snap.baseAmount != null ? snap.baseAmount : round2(Number(snap.amount ?? 0));
  const tol = toleranceFor(remaining);
  if (payBase - remaining > tol) {
    return {
      exceeds: true,
      remainingBase: remaining,
      payBase,
      message: `Payment exceeds remaining balance of ${remaining} ${snap.baseCurrency} (tolerance ${tol})`,
    };
  }
  return { exceeds: false, remainingBase: remaining, payBase };
}

/**
 * Payment create hone ke BAAD allocation finalize: kya invoice fully paid hai?
 * Chhota FX rounding farq (tolerance ke andar) auto-adjust — invoice 'paid' flip.
 * Returns { fullyPaid, remainingBase, roundingAdjustment }
 */
async function finalizeAllocation(tenantId, invoiceId) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
  });
  if (!invoice) return { fullyPaid: false, remainingBase: 0, roundingAdjustment: 0 };
  const { remaining } = await invoiceBaseFigures(tenantId, invoice);
  const tol = toleranceFor(remaining);
  const fullyPaid = remaining <= tol;
  return {
    fullyPaid,
    remainingBase: Math.max(0, remaining),
    roundingAdjustment: fullyPaid ? round2(remaining) : 0,
  };
}

/**
 * Receipt/email ke liye currency display line.
 * e.g. "100 USD (≈ 28,000 PKR @ 1 USD = 280.000000 PKR)"
 */
function receiptCurrencyLine(payment, baseCurrencyCode) {
  const amt = Number(payment.amount);
  const cur = payment.currency || 'PKR';
  const base = baseCurrencyCode || 'PKR';
  if (cur === base || payment.baseAmount == null) {
    return `${amt.toLocaleString()} ${cur}`;
  }
  const fx = payment.fxRate != null ? Number(payment.fxRate) : null;
  const fxPart = fx ? ` @ 1 ${cur} = ${fx} ${base}` : '';
  return `${amt.toLocaleString()} ${cur} (≈ ${Number(payment.baseAmount).toLocaleString()} ${base}${fxPart})`;
}

module.exports = {
  baseCurrency,
  snapshotPaymentCurrency,
  invoiceBaseFigures,
  toleranceFor,
  checkOverpay,
  finalizeAllocation,
  receiptCurrencyLine,
};
