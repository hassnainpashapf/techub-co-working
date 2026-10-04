// Phase 55 Track 5: Concierge Service Billing.
// Completed/done ServiceRequest se member ke liye draft Invoice banata hai.
// NOTE: Invoice model me InvoiceItem nahi hai (schema single-amount) — is liye
// service line item ki tafseel (service name, request title, details, price) notes
// me `[concierge:<requestId>]` marker ke sath likhi jati hai; dobara billing se
// bachne ke liye marker se dedupe hota hai.
// Merge hone se pehle (models absent) functions graceful 503 dete hain — crash nahi.
const prisma = require('./prisma');
const { tenantFilter } = require('./tenant');

const BILLABLE_STATUSES = ['done', 'completed'];

function conciergeEnabled() {
  return !!(prisma && prisma.serviceRequest && prisma.invoice && prisma.member);
}

// INV-YYYYMM-seqq pattern (billing.js / meal-plans.js wala, bina dependency).
async function nextInvoiceNumber(tenantId) {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const countForMonth = await prisma.invoice.count({
    where: { tenantId, number: { startsWith: `INV-${yyyymm}-` } },
  });
  return `INV-${yyyymm}-${String(countForMonth + 1).padStart(4, '0')}`;
}

function lineItemText(request) {
  const serviceName = request.service ? request.service.name : 'Concierge service';
  const parts = [`${serviceName} — ${request.title}`];
  if (request.details) parts.push(`Details: ${String(request.details).slice(0, 300)}`);
  if (request.completedAt) parts.push(`Completed: ${new Date(request.completedAt).toISOString().slice(0, 10)}`);
  parts.push(`[concierge:${request.id}]`);
  return parts.join('\n');
}

// Completed request -> draft (unpaid) invoice. Idempotent: ek request par ek hi invoice.
async function billRequest(tenantId, requestId, opts = {}) {
  if (!conciergeEnabled()) {
    const err = new Error('Concierge billing schema pending migration');
    err.status = 503;
    throw err;
  }
  const request = await prisma.serviceRequest.findFirst({
    where: { id: requestId, tenantId },
    include: { service: true, member: true },
  });
  if (!request) {
    const err = new Error('Service request not found');
    err.status = 404;
    throw err;
  }
  if (!BILLABLE_STATUSES.includes(request.status)) {
    const err = new Error(`Request must be done/completed before billing (current: ${request.status})`);
    err.status = 422;
    throw err;
  }
  // Dedupe: is request par pehle se invoice?
  const existing = await prisma.invoice.findFirst({
    where: { tenantId, notes: { contains: `[concierge:${request.id}]` } },
  });
  if (existing) return { invoice: existing, alreadyBilled: true };

  const amount = opts.amount != null ? Number(opts.amount) : Number(request.price || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Request has no billable amount (price missing)');
    err.status = 422;
    throw err;
  }

  const now = new Date();
  const dueDate = opts.dueDate ? new Date(opts.dueDate) : new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const number = await nextInvoiceNumber(tenantId);
  const invoice = await prisma.invoice.create({
    data: {
      tenantId,
      memberId: request.memberId,
      number,
      periodStart: now,
      periodEnd: now,
      dueDate,
      amount,
      status: 'unpaid',
      invoiceType: 'standard',
      notes: lineItemText(request),
    },
  });
  try {
    const { emitWebhook } = require('./webhooks');
    if (emitWebhook) emitWebhook(tenantId, 'invoice.created', { id: invoice.id, source: 'concierge' });
  } catch (_) { /* webhook optional */ }
  return { invoice, alreadyBilled: false };
}

// Unbilled requests: done/completed, price > 0, invoice marker maujood nahi.
async function unbilledRequests(tenantId, { limit = 50 } = {}) {
  if (!conciergeEnabled()) return [];
  const done = await prisma.serviceRequest.findMany({
    where: { tenantId, status: { in: BILLABLE_STATUSES } },
    include: { service: { select: { name: true } }, member: { select: { id: true, name: true, email: true } } },
    orderBy: { completedAt: 'desc' },
    take: 200,
  });
  const out = [];
  for (const r of done) {
    if (!r.price || Number(r.price) <= 0) continue;
    const billed = await prisma.invoice.findFirst({
      where: { tenantId, notes: { contains: `[concierge:${r.id}]` } },
      select: { id: true },
    });
    if (!billed) {
      out.push({
        id: r.id,
        title: r.title,
        service: r.service ? r.service.name : null,
        member: r.member,
        price: Number(r.price),
        completedAt: r.completedAt,
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

module.exports = { billRequest, unbilledRequests, tenantFilter };
