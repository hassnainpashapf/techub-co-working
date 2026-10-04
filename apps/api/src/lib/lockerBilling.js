// Phase 56 Track 3: Locker Billing — active LockerRental ke liye monthly auto-invoice.
// Monthly billing cycle startDate ke anniversary par: har month ke `yyyy-mm`
// cycle ke liye invoice ban'ta hai, idempotency marker `[locker:<rentalId>:<yyyy-mm>]`
// notes me. Model LockerRental Track 1 (locker-units fragment) se ayega —
// merge se pehle functions graceful 503 dete hain, crash nahi.
// NOTE (coordinator): Track 1 ke fragment me field names `monthlyPrice`, `startDate`,
// `endDate`, `status` ('active') assume kiye hain; mismatch ho to merge waqt align karein.
const prisma = require('./prisma');

function lockerBillingEnabled() {
  return !!(prisma && prisma.lockerRental && prisma.invoice && prisma.member);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// startDate ka day-of-month; chhote months me month ke aakhri din tak.
function anniversaryOf(baseDate, year, monthIdx) {
  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  return new Date(year, monthIdx, Math.min(baseDate.getDate(), lastDay));
}

// Rental ke billable cycles: startDate ke month se aaj ke month tak,
// sirf wo cycles jinki anniversary date guzar chuki ho. Max 24 cycles (backfill cap).
function billableCycles(rental, now = new Date()) {
  const start = new Date(rental.startDate);
  if (Number.isNaN(start.getTime())) return [];
  const cycles = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  for (let i = 0; i < 24; i++) {
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) break;
    const anniversary = anniversaryOf(start, y, m);
    if (anniversary <= now) cycles.push({ year: y, month: m, dueDate: anniversary });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return cycles;
}

function markerFor(rentalId, cycle) {
  const key = `${cycle.year}-${String(cycle.month + 1).padStart(2, '0')}`;
  return `[locker:${rentalId}:${key}]`;
}

// Billable amount: merged schema field names (Phase 56: monthlyRate).
function rentalAmount(rental) {
  const v = rental.monthlyPrice ?? rental.monthlyRate ?? rental.price ?? rental.rate
    ?? rental.locker?.monthlyFee ?? rental.locker?.monthlyRate ?? rental.locker?.price ?? 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function invoiceText(rental, cycle) {
  const lockerName = rental.locker?.name || rental.locker?.code || 'Locker';
  const key = `${cycle.year}-${String(cycle.month + 1).padStart(2, '0')}`;
  return [`${lockerName} — monthly rental (${key})`, markerFor(rental.id, cycle)].join('\n');
}

// Ek rental ka ek cycle bill karo (idempotent).
async function billCycle(tenantId, rental, cycle, opts = {}) {
  const marker = markerFor(rental.id, cycle);
  const existing = await prisma.invoice.findFirst({
    where: { tenantId, notes: { contains: marker } },
    select: { id: true },
  });
  if (existing) return { invoice: existing, alreadyBilled: true };

  const amount = opts.amount != null ? Number(opts.amount) : rentalAmount(rental);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Locker rental has no billable amount (monthlyPrice missing)');
    err.status = 422;
    throw err;
  }

  const now = new Date();
  const yyyymm = `${cycle.year}${String(cycle.month + 1).padStart(2, '0')}`;
  const countForMonth = await prisma.invoice.count({
    where: { tenantId, number: { startsWith: `INV-${yyyymm}-` } },
  });
  const number = `INV-${yyyymm}-${String(countForMonth + 1).padStart(4, '0')}`;

  const invoice = await prisma.invoice.create({
    data: {
      tenantId,
      memberId: rental.memberId,
      number,
      periodStart: new Date(cycle.year, cycle.month, 1),
      periodEnd: new Date(cycle.year, cycle.month + 1, 0),
      dueDate: cycle.dueDate,
      amount,
      status: 'unpaid',
      invoiceType: 'standard',
      notes: invoiceText(rental, cycle),
    },
  });
  try {
    const { emitWebhook } = require('./webhooks');
    if (emitWebhook) emitWebhook(tenantId, 'invoice.created', { id: invoice.id, source: 'locker' });
  } catch (_) { /* webhook optional */ }
  return { invoice, alreadyBilled: false };
}

function rentalActive(rental, now = new Date()) {
  if (String(rental.status).toLowerCase() !== 'active') return false;
  if (rental.endDate && new Date(rental.endDate) < now) return false;
  return true;
}

// Ek tenant (ya opts.tenantId) ke due rentals bill karo.
async function runLockerBilling(tenantId, opts = {}) {
  if (!lockerBillingEnabled()) {
    const err = new Error('Locker billing schema pending migration');
    err.status = 503;
    throw err;
  }
  const now = new Date();
  const rentals = await prisma.lockerRental.findMany({
    where: { tenantId, status: 'active' },
    include: { locker: true },
  });
  const stats = { billed: 0, alreadyBilled: 0, skipped: 0, invoices: [] };
  for (const rental of rentals) {
    if (!rentalActive(rental, now)) { stats.skipped += 1; continue; }
    for (const cycle of billableCycles(rental, now)) {
      if (opts.dryRun) { stats.billed += 1; continue; }
      const { invoice, alreadyBilled } = await billCycle(tenantId, rental, cycle, opts);
      if (alreadyBilled) stats.alreadyBilled += 1;
      else { stats.billed += 1; stats.invoices.push(invoice.id); }
    }
  }
  return stats;
}

// Unbilled: due cycles jin par abhi invoice nahi.
async function unbilledRentals(tenantId, { limit = 50 } = {}) {
  if (!lockerBillingEnabled()) return [];
  const now = new Date();
  const rentals = await prisma.lockerRental.findMany({
    where: { tenantId, status: 'active' },
    include: { locker: { select: { name: true, code: true } }, member: { select: { id: true, name: true, email: true } } },
    take: 200,
  });
  const out = [];
  for (const rental of rentals) {
    if (!rentalActive(rental, now)) continue;
    for (const cycle of billableCycles(rental, now)) {
      const existing = await prisma.invoice.findFirst({
        where: { tenantId, notes: { contains: markerFor(rental.id, cycle) } },
        select: { id: true },
      });
      if (!existing) {
        out.push({
          rentalId: rental.id,
          member: rental.member,
          locker: rental.locker,
          cycle: `${cycle.year}-${String(cycle.month + 1).padStart(2, '0')}`,
          dueDate: cycle.dueDate,
          amount: rentalAmount(rental),
        });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

module.exports = { runLockerBilling, unbilledRentals, billableCycles, markerFor, rentalAmount };
