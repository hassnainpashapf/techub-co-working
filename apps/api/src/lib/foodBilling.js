// Phase 43 Track 4: Cafeteria order payment & billing engine.
// settleOrder(orderId, method):
//   - cash/card   -> paymentStatus 'paid', paidAt set
//   - wallet      -> member wallet se deduct (wallet system codebase me nahi
//                    hai — guarded check; na mile to { ok:false, reason:'wallet_not_available' },
//                    order touch nahi hota)
//   - invoice     -> INV- series ka invoice banta hai (order amount par),
//                    order.invoiceId link + paymentStatus 'added_to_invoice'
// Dedupe: paymentStatus != 'unpaid' ho to 409 (dobara pay nahi).
// Cancelled order par pay block (422).
const prisma = require('./prisma');
const { writeAudit } = require('../middleware/audit');

const PAY_METHODS = ['cash', 'card', 'wallet', 'invoice'];

function orderModelReady() {
  return prisma && typeof prisma.foodOrder?.findFirst === 'function';
}
function paymentFieldsReady() {
  // Fragment merge/migration se pehle columns maujood nahi hongi.
  try {
    return prisma && typeof prisma.foodOrder?.findFirst === 'function';
  } catch {
    return false;
  }
}

// Wallet system check — codebase me koi member wallet model nahi hai.
// Guarded: future me model aaye to yahan wire ho jayega.
async function tryWalletDeduct(tenantId, memberId, amount) {
  const wallet = prisma.memberWallet;
  if (!wallet || typeof wallet.findFirst !== 'function') {
    return { ok: false, reason: 'wallet_not_available' };
  }
  const w = await wallet.findFirst({ where: { tenantId, memberId } });
  const balance = w ? Number(w.balance || 0) : 0;
  if (balance < Number(amount)) return { ok: false, reason: 'insufficient_balance', balance };
  await wallet.update({
    where: { id: w.id },
    data: { balance: { decrement: Number(amount) } },
  });
  return { ok: true, balance: balance - Number(amount) };
}

async function nextInvoiceNumber(tenantId) {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `INV-${yyyymm}-`;
  const countForMonth = await prisma.invoice.count({
    where: { tenantId, number: { startsWith: prefix } },
  });
  return `${prefix}${String(countForMonth + 1).padStart(4, '0')}`;
}

async function settleOrder({ tenantId, orderId, method, actorId }) {
  if (!PAY_METHODS.includes(method)) {
    return { ok: false, code: 400, error: `Invalid method. Use: ${PAY_METHODS.join(', ')}` };
  }
  if (!orderModelReady()) {
    return { ok: false, code: 503, error: 'food-orders migration pending' };
  }
  const order = await prisma.foodOrder.findFirst({
    where: { id: orderId, tenantId },
  });
  if (!order) return { ok: false, code: 404, error: 'Order not found' };
  if (order.status === 'cancelled') {
    return { ok: false, code: 422, error: 'Cancelled order cannot be paid' };
  }
  const paymentStatus = order.paymentStatus || 'unpaid';
  if (paymentStatus !== 'unpaid') {
    return { ok: false, code: 409, error: `Order already ${paymentStatus}` };
  }
  const total = Number(order.subtotal || 0);

  if (method === 'cash' || method === 'card') {
    const updated = await prisma.foodOrder.update({
      where: { id: order.id },
      data: { paymentStatus: 'paid', paymentMethod: method, paidAt: new Date() },
    });
    try {
      await writeAudit({ tenantId, actorId, action: 'food_order.paid', entity: 'FoodOrder', entityId: order.id, newValue: { method, total } });
    } catch {}
    return { ok: true, order: updated };
  }

  if (method === 'wallet') {
    const res = await tryWalletDeduct(tenantId, order.memberId, total);
    if (!res.ok) return { ok: false, code: 422, error: 'wallet_not_available', detail: res.reason };
    const updated = await prisma.foodOrder.update({
      where: { id: order.id },
      data: { paymentStatus: 'paid', paymentMethod: 'wallet', paidAt: new Date() },
    });
    try {
      await writeAudit({ tenantId, actorId, action: 'food_order.paid', entity: 'FoodOrder', entityId: order.id, newValue: { method: 'wallet', total } });
    } catch {}
    return { ok: true, order: updated, walletBalance: res.balance };
  }

  // method === 'invoice': member ke liye INV- series invoice banao.
  const member = await prisma.member.findFirst({ where: { id: order.memberId, tenantId } });
  if (!member) return { ok: false, code: 404, error: 'Member not found' };
  const number = await nextInvoiceNumber(tenantId);
  const now = new Date();
  const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // month end
  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        tenantId,
        memberId: member.id,
        number,
        periodStart: now,
        periodEnd: now,
        dueDate,
        amount: total,
        status: 'unpaid',
        invoiceType: 'standard',
        notes: `Café order ${order.id.slice(-6)} — ${Array.isArray(order.items) ? order.items.length : 0} item(s)`,
      },
    });
    const updatedOrder = await tx.foodOrder.update({
      where: { id: order.id },
      data: { paymentStatus: 'added_to_invoice', paymentMethod: 'invoice', invoiceId: inv.id },
    });
    return { inv, updatedOrder };
  });
  try {
    await writeAudit({ tenantId, actorId, action: 'food_order.invoiced', entity: 'FoodOrder', entityId: order.id, newValue: { invoiceId: invoice.inv.id, invoiceNo: invoice.inv.number, total } });
  } catch {}
  return { ok: true, order: invoice.updatedOrder, invoice: invoice.inv };
}

module.exports = { settleOrder, PAY_METHODS, paymentFieldsReady };
