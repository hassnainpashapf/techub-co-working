// Phase 39 Track 4: Quotation auto-expiry job.
// Self-schedules daily at ~03:00; handler registered on require (like docExpiryJob).
const jobs = require('./jobs');
const prisma = require('./prisma');

// Sent (or draft) quotations past their validity -> expired.
async function processQuotationExpiry() {
  if (typeof prisma.quotation === 'undefined') return { skipped: true };
  const now = new Date();
  const res = await prisma.quotation.updateMany({
    where: { validTill: { lt: now }, status: { in: ['draft', 'sent'] } },
    data: { status: 'expired' },
  });
  return { expired: res.count };
}

jobs.registerHandler('quotation-expiry', async () => {
  const out = await processQuotationExpiry();
  await jobs.enqueue('quotation-expiry', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).catch(() => {});
  return out;
});

async function ensureQuotationExpiryScheduled() {
  try {
    const pending = await prisma.job.count({ where: { type: 'quotation-expiry', status: 'pending' } }).catch(() => 1);
    if (pending) return;
    const tonight = new Date();
    tonight.setHours(3, 0, 0, 0);
    if (tonight <= new Date()) tonight.setDate(tonight.getDate() + 1);
    await jobs.enqueue('quotation-expiry', {}, { runAt: tonight }).catch(() => {});
  } catch (e) { /* ignore */ }
}

module.exports = { processQuotationExpiry, ensureQuotationExpiryScheduled };
