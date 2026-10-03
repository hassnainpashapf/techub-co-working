// Phase 31: Recurring invoice generator — runs via the job queue.
// Processes due RecurringInvoice rows (nextRunAt <= now, status active),
// creates a real Invoice for each, emails the member, and advances nextRunAt.
const prisma = require('./prisma');
const { notify } = require('./mailer');
const { emitWebhook } = require('./webhooks');
const { advanceRunAt } = require('../routes/recurring-invoices');

async function nextInvoiceNumber(tenantId, date) {
  const yyyymm = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const countForMonth = await prisma.invoice.count({
    where: { tenantId, number: { startsWith: `INV-${yyyymm}-` } },
  });
  const seq = String(countForMonth + 1).padStart(4, '0');
  return `INV-${yyyymm}-${seq}`;
}

async function processRecurringInvoices() {
  const now = new Date();
  const due = await prisma.recurringInvoice.findMany({
    where: { status: 'active', nextRunAt: { lte: now } },
    include: { member: { select: { id: true, name: true, email: true, tenantId: true } } },
    take: 50,
  });

  let generated = 0;
  for (const rule of due) {
    try {
      // Expired by endDate → auto-cancel, never bill past the end.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (rule.endDate && new Date(rule.endDate) < today) {
        await prisma.recurringInvoice.update({
          where: { id: rule.id },
          data: { status: 'cancelled' },
        });
        continue;
      }

      const runDate = new Date(rule.nextRunAt);
      runDate.setHours(0, 0, 0, 0);
      const periodStart = new Date(runDate.getFullYear(), runDate.getMonth(), 1);
      const periodEnd = new Date(runDate.getFullYear(), runDate.getMonth() + 1, 0);
      const dueDate = new Date(periodEnd);
      dueDate.setDate(dueDate.getDate() + 7);

      // Idempotent: don't double-bill the same recurring rule for the same month.
      const yyyymm = `${runDate.getFullYear()}${String(runDate.getMonth() + 1).padStart(2, '0')}`;
      const exists = await prisma.invoice.findFirst({
        where: {
          tenantId: rule.tenantId,
          memberId: rule.memberId,
          number: { startsWith: `INV-${yyyymm}-` },
          notes: { contains: `[recurring:${rule.id}]` },
        },
      });
      if (exists) {
        await prisma.recurringInvoice.update({
          where: { id: rule.id },
          data: {
            lastGeneratedAt: runDate,
            nextRunAt: advanceRunAt(rule.nextRunAt, rule.frequency),
          },
        });
        continue;
      }

      const number = await nextInvoiceNumber(rule.tenantId, runDate);
      const invoice = await prisma.invoice.create({
        data: {
          tenantId: rule.tenantId,
          memberId: rule.memberId,
          number,
          periodStart,
          periodEnd,
          dueDate,
          amount: rule.amount,
          status: 'unpaid',
          notes: `${rule.title} [recurring:${rule.id}]`,
        },
      });

      await prisma.recurringInvoice.update({
        where: { id: rule.id },
        data: {
          lastGeneratedAt: runDate,
          nextRunAt: advanceRunAt(rule.nextRunAt, rule.frequency),
        },
      });

      // Email the member (queued via mailer → job queue, never blocks).
      if (rule.member && rule.member.email) {
        notify(rule.tenantId, rule.member.email, 'invoiceCreated', {
          memberName: rule.member.name,
          number: invoice.number,
          amount: Number(invoice.amount),
          dueDate: dueDate.toISOString().slice(0, 10),
        }).catch(() => {});
      }

      emitWebhook(rule.tenantId, 'invoice.created', {
        invoiceId: invoice.id,
        number: invoice.number,
        recurring: rule.id,
      });
      generated += 1;
    } catch (err) {
      console.error(`[recurring-invoice] failed for rule ${rule.id}:`, err.message);
    }
  }
  return { generated, checked: due.length };
}

// Auto-register with the job queue when available (module load = coordinator
// only needs `require('./lib/recurringInvoiceJob')` in server.js).
(function register() {
  try {
    const jobs = require('./jobs');
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('recurring-invoice', async () => processRecurringInvoices());
    }
  } catch {
    /* jobs module not present — coordinator merges it later */
  }
})();

module.exports = { processRecurringInvoices };
