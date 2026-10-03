// Phase 46 Track 5: FX Gain/Loss Tracking — lib.
//
// Invoice book value (base currency) invoice-time ke fxRate par fix hoti hai;
// payment ka asal base-currency value payment-time ke fxRate par hota hai.
// Farq = FX gain (+) / loss (-).
//
// Math (dono taraf invoice currency me):
//   bookValue = settledAmountInvCur * invoiceFxRate   (base currency)
//   cashValue = settledAmountInvCur * paymentFxRate   (base currency)
//   diff      = cashValue - bookValue                  (+gain / -loss)
// fxRate convention: base-currency units per 1 unit of invoice/payment currency.
//
// Loss  -> auto Expense (category "other", status "approved", note me FX reference).
// Gain  -> FxGainLoss row record hoti hai; Income model codebase me maujood nahi,
//          is liye gain sirf summary me dikhta hai (P&L integration note neeche).

const prisma = require('./prisma');
const { writeAudit } = require('../middleware/audit');

// Immaterial threshold (base currency): is se chhota farq record nahi hota.
const IMMATERIAL = 0.01;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Pure computation — bina DB ke test karne ke liye export.
function computeFxDiff({ invoiceFxRate, paymentFxRate, settledAmountInvCur }) {
  const invR = num(invoiceFxRate) || 1;
  const payR = num(paymentFxRate) || 1;
  const amt = num(settledAmountInvCur);
  const bookValue = amt * invR;
  const cashValue = amt * payR;
  const diff = cashValue - bookValue;
  const reason = invR !== payR ? 'rate_change' : 'rounding';
  return { diff, bookValue, cashValue, reason };
}

function schemaReady() {
  try {
    return !!(prisma.fxGainLoss && prisma.expense);
  } catch {
    return false;
  }
}

// Payment allocate hote waqt call karo (fire-and-forget safe).
// opts: { tenantId, paymentId, invoiceId, settledAmountInvCur, actorId }
// settledAmountInvCur = payment ne invoice ki currency me kitna settle kiya.
//   (payment currency == invoice currency ho to seedha payment.amount)
// Cross-currency ho aur caller ke paas converted amount na ho -> skip (koi andaza nahi).
async function recordFxGainLoss({ tenantId, paymentId, invoiceId, settledAmountInvCur, actorId = null }) {
  if (!schemaReady()) return { ok: false, reason: 'not_migrated' };
  if (!tenantId || !paymentId || !invoiceId) return { ok: false, reason: 'missing_ids' };
  try {
    // Dedupe: ek payment par ek hi FxGainLoss row.
    const existing = await prisma.fxGainLoss.findFirst({ where: { tenantId, paymentId } });
    if (existing) return { ok: false, reason: 'already_recorded', id: existing.id };

    const [invoice, payment] = await Promise.all([
      prisma.invoice.findFirst({ where: { id: invoiceId, tenantId }, select: { id: true, number: true, fxRate: true } }),
      prisma.payment.findFirst({ where: { id: paymentId, tenantId }, select: { id: true, receiptNo: true, fxRate: true } }),
    ]);
    if (!invoice || !payment) return { ok: false, reason: 'not_found' };

    // Tracks 3/4 ke currency fields merge na hue hon to skip (koi fake math nahi).
    if (invoice.fxRate === undefined || payment.fxRate === undefined) {
      return { ok: false, reason: 'currency_fields_missing' };
    }

    const { diff, reason } = computeFxDiff({
      invoiceFxRate: invoice.fxRate,
      paymentFxRate: payment.fxRate,
      settledAmountInvCur,
    });
    if (Math.abs(diff) < IMMATERIAL) return { ok: false, reason: 'immaterial' };

    const rounded = Math.round(diff * 100) / 100;
    let expenseId = null;

    // Loss -> auto expense (approved, taake P&L me foran aaye).
    if (rounded < 0) {
      const expense = await prisma.expense.create({
        data: {
          tenantId,
          category: 'other',
          amount: Math.abs(rounded),
          date: new Date(),
          paidBy: 'system',
          note: `FX loss — invoice ${invoice.number || invoiceId}, payment ${payment.receiptNo || paymentId} (rate change)`,
          status: 'approved',
          createdById: actorId || undefined,
        },
      });
      expenseId = expense.id;
    }
    // Gain -> koi Income model nahi, sirf FxGainLoss row + summary (integration note neeche).

    const row = await prisma.fxGainLoss.create({
      data: { tenantId, invoiceId, paymentId, amount: rounded, reason, expenseId },
    });

    writeAudit({
      tenantId,
      actorId,
      action: rounded < 0 ? 'fx.loss_booked' : 'fx.gain_recorded',
      entity: 'FxGainLoss',
      entityId: row.id,
      newValue: { amount: rounded, reason, invoiceId, paymentId, expenseId },
    }).catch(() => {});

    return { ok: true, id: row.id, amount: rounded, reason, expenseId };
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message };
  }
}

module.exports = { computeFxDiff, recordFxGainLoss, schemaReady, IMMATERIAL };
