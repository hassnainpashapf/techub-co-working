// Phase 38 Track 7: Document Expiry reminders — daily job.
// Coordinator wiring: server.js me `require('./lib/docExpiryJob');`
// taake handler auto-register ho jaye + `ensureDocExpiryScheduled()` call ho.
//
// Job: har document jis ka expiresAt set hai —
//   * daysLeft reminderDays me se kisi threshold par pohnche (30/7/1 default) -> member + admins ko email
//   * expired ho jaye (daysLeft < 0) -> ek dafa expired notice
// Duplicate se bachao: lastReminderKey = "<expiresAtISO>:<days>" — expiresAt badalne par cycle reset.

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

function getJobs() {
  try {
    return require('./jobs');
  } catch {
    return null;
  }
}

function daysLeftOf(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function expiryStatus(daysLeft) {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'expiring';
  return 'valid';
}

async function processDocExpiry(payload = {}) {
  if (!prisma.document) {
    console.error('[doc-expiry] Document model not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }
  // Model ke naye fields migrate na hue hon to gracefully skip.
  let docs;
  try {
    docs = await prisma.document.findMany({
      where: { expiresAt: { not: null } },
      include: { member: { select: { id: true, name: true, email: true } } },
    });
  } catch (e) {
    console.error('[doc-expiry] expiry columns not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }

  // tenant -> admins cache (ek dafa per tenant)
  const adminCache = {};
  async function tenantAdmins(tenantId) {
    if (!adminCache[tenantId]) {
      adminCache[tenantId] = await prisma.user.findMany({
        where: { tenantId, role: { in: ['ceo', 'admin'] }, isActive: true, email: { not: null } },
        select: { name: true, email: true },
      }).catch(() => []);
    }
    return adminCache[tenantId];
  }

  let sent = 0;
  for (const doc of docs) {
    const daysLeft = daysLeftOf(doc.expiresAt);
    const status = expiryStatus(daysLeft);
    const reminders = Array.isArray(doc.reminderDays) ? doc.reminderDays : [30, 7, 1];
    const keyBase = new Date(doc.expiresAt).toISOString();

    let trigger = null;
    if (status === 'expired') {
      if (doc.lastReminderKey !== `${keyBase}:expired`) trigger = 'expired';
    } else if (status === 'expiring') {
      for (const r of [...reminders].sort((a, b) => b - a)) {
        if (daysLeft <= r && doc.lastReminderKey !== `${keyBase}:${r}`) {
          trigger = String(r);
          break;
        }
      }
    }
    if (!trigger) continue;

    const subject = trigger === 'expired'
      ? `⛔ Document expired: ${doc.title}`
      : `⏰ Document expiring in ${trigger} day${trigger === '1' ? '' : 's'}: ${doc.title}`;
    const html = `
      <p>Assalam-o-Alaikum,</p>
      <p>Document <strong>${doc.title}</strong> (${doc.category || 'general'})
      ${trigger === 'expired'
        ? `<strong style="color:#ef4444">expire ho chuka hai</strong> (${Math.abs(daysLeft)} din pehle).`
        : `sirf <strong>${trigger} din</strong> me expire ho raha hai`}.</p>
      <p>Expiry date: ${new Date(doc.expiresAt).toLocaleDateString()}</p>
      ${doc.member ? `<p>Member: ${doc.member.name}</p>` : ''}
      <p>Please renew it in the Compliance section.</p>`;

    const recipients = [];
    if (doc.member && doc.member.email) {
      recipients.push({ to: doc.member.email, name: doc.member.name });
    }
    for (const a of await tenantAdmins(doc.tenantId)) {
      if (!recipients.some((r) => r.to === a.email)) recipients.push({ to: a.email, name: a.name });
    }

    let okCount = 0;
    for (const r of recipients) {
      try {
        await sendEmail(doc.tenantId, { to: r.to, subject, html });
        okCount += 1;
      } catch (e) {
        console.error(`[doc-expiry] email failed to ${r.to}:`, e.message);
      }
    }
    if (okCount > 0) {
      await prisma.document.update({
        where: { id: doc.id },
        data: { lastReminderKey: `${keyBase}:${trigger}` },
      }).catch(() => {});
      sent += okCount;
    }
  }

  // Khud ko kal ke liye dobara schedule karo (nightly self-rescheduling).
  try {
    const jobs = getJobs();
    if (jobs) {
      await jobs.enqueue('doc-expiry', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    }
  } catch { /* ignore */ }

  return { ok: true, sent, checked: docs.length };
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('doc-expiry', processDocExpiry);
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

// Boot par ensure karo ke daily run scheduled hai (backup.js wala pattern).
async function ensureDocExpiryScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'doc-expiry', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const tonight = new Date();
      tonight.setHours(2, 0, 0, 0);
      if (tonight.getTime() < Date.now()) tonight.setDate(tonight.getDate() + 1);
      await jobs.enqueue('doc-expiry', {}, { runAt: tonight });
    }
  } catch (e) {
    console.error('[doc-expiry] ensure schedule failed:', e.message);
  }
}

module.exports = { processDocExpiry, ensureDocExpiryScheduled, expiryStatus, daysLeftOf };
