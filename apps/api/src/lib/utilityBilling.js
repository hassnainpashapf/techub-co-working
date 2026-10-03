// Phase 51 Track 3: Utility Billing engine
// Meter readings se consumption nikal kar UtilityBill + Invoice banata hai.
// Kabhi throw nahi karta agar models merge na hon — graceful { skipped } deta hai.
const prisma = require('./prisma');
const { writeAudit } = require('../middleware/audit');

const ROUND2 = (n) => Math.round(Number(n) * 100) / 100;

function modelsReady() {
  return Boolean(prisma.utilityRate && prisma.utilityBill && prisma.utilityMeter && prisma.meterReading);
}

// Us date par lagu rate (sab se recent effectiveFrom <= date)
async function getApplicableRate(tenantId, type, date) {
  const rate = await prisma.utilityRate.findFirst({
    where: { tenantId, type, effectiveFrom: { lte: date } },
    orderBy: { effectiveFrom: 'desc' },
  });
  return rate; // null = rate set nahi
}

// Period ki consumption: period ki aakhri reading - period se pehle ki aakhri reading
async function computeConsumption(tenantId, meterId, periodStart, periodEnd) {
  const startReading = await prisma.meterReading.findFirst({
    where: { tenantId, meterId, readAt: { lt: periodStart } },
    orderBy: { readAt: 'desc' },
  });
  const endReading = await prisma.meterReading.findFirst({
    where: { tenantId, meterId, readAt: { gte: periodStart, lte: periodEnd } },
    orderBy: { readAt: 'desc' },
  });
  if (!endReading) return { ok: false, reason: 'no_readings' };
  if (!startReading) return { ok: false, reason: 'no_baseline' };
  const consumption = Number(endReading.reading) - Number(startReading.reading);
  if (consumption < 0) return { ok: false, reason: 'negative_consumption' };
  return { ok: true, consumption: ROUND2(consumption), endReading };
}

// Meter ke unit par active contract se member nikalo
async function resolveBillMember(tenantId, meter) {
  if (!meter.unitId) return null;
  const contract = await prisma.contract.findFirst({
    where: { tenantId, unitId: meter.unitId, status: 'active' },
    orderBy: { startDate: 'desc' },
  });
  return contract ? contract.memberId : null;
}

async function nextInvoiceNumber(tenantId) {
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
  const count = await prisma.invoice.count({
    where: { tenantId, number: { startsWith: `INV-${yyyymm}-` } },
  });
  return `INV-${yyyymm}-${String(count + 1).padStart(4, '0')}`;
}

async function currencySnapshot(tenantId, amount) {
  try {
    const { resolveInvoiceCurrency } = require('./invoiceCurrency');
    return await resolveInvoiceCurrency(tenantId, null, amount);
  } catch {
    return {};
  }
}

// Main: period ke bills generate karo. Idempotent — dobara chalane par duplicate nahi.
async function generateUtilityBills(tenantId, periodStart, periodEnd, actorId) {
  if (!modelsReady()) return { skipped: 'not_migrated' };
  const tf = { tenantId };
  const meters = await prisma.utilityMeter.findMany({ where: { ...tf, isActive: true } });
  const results = { generated: 0, drafted: 0, skipped: [], bills: [] };

  for (const meter of meters) {
    try {
      const existing = await prisma.utilityBill.findFirst({
        where: { tenantId, meterId: meter.id, periodStart: new Date(periodStart) },
      });
      if (existing) { results.skipped.push({ meter: meter.name, reason: 'already_billed' }); continue; }

      const rate = await getApplicableRate(tenantId, meter.type, new Date(periodEnd));
      if (!rate) { results.skipped.push({ meter: meter.name, reason: 'no_rate' }); continue; }

      const cons = await computeConsumption(tenantId, meter.id, new Date(periodStart), new Date(periodEnd));
      if (!cons.ok) { results.skipped.push({ meter: meter.name, reason: cons.reason }); continue; }

      const fixed = Number(rate.fixedCharge || 0);
      const amount = ROUND2(cons.consumption * Number(rate.ratePerUnit) + fixed);
      const memberId = await resolveBillMember(tenantId, meter);

      let invoiceId = null;
      let status = 'draft';
      if (memberId) {
        const cur = await currencySnapshot(tenantId, amount);
        const number = await nextInvoiceNumber(tenantId);
        const dueDate = new Date(periodEnd);
        dueDate.setDate(dueDate.getDate() + 7);
        const invData = {
          tenantId,
          memberId,
          number,
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
          dueDate,
          amount,
          status: 'unpaid',
          notes: `Utility: ${meter.name} (${meter.type}) — ${cons.consumption} units @ ${rate.ratePerUnit}/unit${fixed ? ` + ${fixed} fixed` : ''}`,
          ...cur,
        };
        try {
          const inv = await prisma.invoice.create({ data: invData });
          invoiceId = inv.id;
          status = 'billed';
        } catch (err) {
          if (err.code === 'P2022') {
            const { currency, fxRate, baseAmount, ...legacy } = invData;
            const inv = await prisma.invoice.create({ data: legacy });
            invoiceId = inv.id;
            status = 'billed';
          } else throw err;
        }
      }

      const bill = await prisma.utilityBill.create({
        data: {
          tenantId,
          memberId,
          unitId: meter.unitId || null,
          meterId: meter.id,
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
          consumption: cons.consumption,
          ratePerUnit: rate.ratePerUnit,
          fixedCharge: fixed,
          amount,
          invoiceId,
          status,
        },
      });
      if (status === 'billed') results.generated++; else results.drafted++;
      results.bills.push({ id: bill.id, meter: meter.name, amount, status });
    } catch (e) {
      results.skipped.push({ meter: meter.name, reason: 'error' });
    }
  }

  try {
    await writeAudit({ tenantId, actorId: actorId || null, action: 'utility.generate', entity: 'UtilityBill', entityId: null, newValue: { periodStart, periodEnd, ...results } });
  } catch {}
  return results;
}

// Draft bill ko member assign karke invoice banao
async function billDraftToInvoice(tenantId, billId, memberId, actorId) {
  if (!modelsReady()) return { skipped: 'not_migrated' };
  const bill = await prisma.utilityBill.findFirst({ where: { id: billId, tenantId }, include: { meter: true } });
  if (!bill) return { error: 'not_found' };
  if (bill.status !== 'draft') return { error: 'not_draft' };
  const cur = await currencySnapshot(tenantId, Number(bill.amount));
  const number = await nextInvoiceNumber(tenantId);
  const dueDate = new Date(bill.periodEnd);
  dueDate.setDate(dueDate.getDate() + 7);
  const invData = {
    tenantId,
    memberId,
    number,
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    dueDate,
    amount: bill.amount,
    status: 'unpaid',
    notes: `Utility: ${bill.meter?.name || ''} (${bill.meter?.type || ''}) — ${bill.consumption} units`,
    ...cur,
  };
  let inv;
  try {
    inv = await prisma.invoice.create({ data: invData });
  } catch (err) {
    if (err.code === 'P2022') {
      const { currency, fxRate, baseAmount, ...legacy } = invData;
      inv = await prisma.invoice.create({ data: legacy });
    } else throw err;
  }
  const updated = await prisma.utilityBill.update({
    where: { id: billId },
    data: { memberId, invoiceId: inv.id, status: 'billed' },
  });
  try {
    await writeAudit({ tenantId, actorId: actorId || null, action: 'utility.bill_to_invoice', entity: 'UtilityBill', entityId: billId, newValue: { invoiceId: inv.id } });
  } catch {}
  return { bill: updated, invoiceId: inv.id };
}

module.exports = {
  generateUtilityBills,
  billDraftToInvoice,
  getApplicableRate,
  computeConsumption,
  modelsReady,
};
