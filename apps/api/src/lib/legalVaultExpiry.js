// Phase 50 Track 4: Legal Document Vault — expiry reminders daily job.
// Coordinator wiring (server.js, additive):
//   require('./lib/legalVaultExpiry');
//   require('./lib/legalVaultExpiry').ensureLegalVaultExpiryScheduled();
//
// Job: har active LegalDocument jis ka expiresAt set hai —
//   * daysLeft reminderDays ([30,7,1] default) ke kisi threshold par pohnche -> ceo/admin + related member/vendor ko email + in-app notification
//   * expired ho jaye (daysLeft < 0) -> ek dafa expired notice
// Duplicate se bachao: lastReminderKey = "<expiresAtISO>:<days>" — expiresAt badalne par cycle reset.

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');
const { createNotification } = require('./notify');

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.registerHandler === 'function') return j;
    return null;
  } catch {
    return null;
  }
}

function daysLeftOf(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

const adminCache = {};
async function tenantAdmins(tenantId) {
  if (!adminCache[tenantId]) {
    adminCache[tenantId] = await prisma.user
      .findMany({
        where: { tenantId, role: { in: ['ceo', 'admin'] }, isActive: true, email: { not: null } },
        select: { id: true, name: true, email: true },
      })
      .catch(() => []);
  }
  return adminCache[tenantId];
}

async function processLegalVaultExpiry(payload = {}) {
  if (!prisma.legalDocument) {
    console.error('[legal-vault-expiry] LegalDocument model not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }
  let docs;
  try {
    docs = await prisma.legalDocument.findMany({
      where: { status: 'active', expiresAt: { not: null } },
      include: {
        relatedMember: { select: { id: true, name: true, email: true } },
        relatedVendor: { select: { id: true, name: true, email: true } },
      },
    });
  } catch (e) {
    console.error('[legal-vault-expiry] legal_documents not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }

  let sent = 0;
  for (const doc of docs) {
    const daysLeft = daysLeftOf(doc.expiresAt);
    const reminders = Array.isArray(doc.reminderDays) ? doc.reminderDays : [30, 7, 1];
    const keyBase = new Date(doc.expiresAt).toISOString();

    let trigger = null;
    if (daysLeft < 0) {
      if (doc.lastReminderKey !== `${keyBase}:expired`) trigger = 'expired';
    } else {
      for (const r of [...reminders].sort((a, b) => b - a)) {
        if (daysLeft <= r && doc.lastReminderKey !== `${keyBase}:${r}`) {
          trigger = String(r);
          break;
        }
      }
    }
    if (!trigger) continue;

    const when = new Date(doc.expiresAt).toLocaleDateString();
    const subject = trigger === 'expired'
      ? `⛔ Legal document expired: ${doc.title}`
      : `⏰ Legal document expiring in ${trigger} day${trigger === '1' ? '' : 's'}: ${doc.title}`;
    const html = `
      <p>Assalam-o-Alaikum,</p>
      <p>Legal document <strong>${doc.title}</strong> (${doc.category || 'other'})
      ${trigger === 'expired'
        ? `<strong style="color:#ef4444">expire ho chuka hai</strong> (${Math.abs(daysLeft)} din pehle).`
        : `sirf <strong>${trigger} din</strong> me expire ho raha hai`}.</p>
      <p>Expiry date: ${when}</p>
      ${doc.relatedMember ? `<p>Member: ${doc.relatedMember.name}</p>` : ''}
      ${doc.relatedVendor ? `<p>Vendor: ${doc.relatedVendor.name}</p>` : ''}
      <p>Please renew it in the Legal section.</p>`;

    const recipients = [];
    const admins = await tenantAdmins(doc.tenantId);
    for (const a of admins) recipients.push({ to: a.email, name: a.name });
    if (doc.relatedMember?.email && !recipients.some((r) => r.to === doc.relatedMember.email)) {
      recipients.push({ to: doc.relatedMember.email, name: doc.relatedMember.name });
    }
    if (doc.relatedVendor?.email && !recipients.some((r) => r.to === doc.relatedVendor.email)) {
      recipients.push({ to: doc.relatedVendor.email, name: doc.relatedVendor.name });
    }

    let okCount = 0;
    for (const r of recipients) {
      try {
        await sendEmail(doc.tenantId, { to: r.to, subject, html });
        okCount += 1;
      } catch (e) {
        console.error(`[legal-vault-expiry] email failed to ${r.to}:`, e.message);
      }
    }

    // In-app notification (roles: ceo/admin/manager — ek per role)
    for (const r of ['ceo', 'admin', 'manager']) {
      try {
        await createNotification(prisma, {
          tenantId: doc.tenantId,
          role: r,
          type: 'legal_document_expiry',
          message: trigger === 'expired'
            ? `⛔ ${doc.title} expire ho chuka hai (${Math.abs(daysLeft)} din pehle).`
            : `⏰ ${doc.title} ${trigger} din me expire ho raha hai.`,
        });
      } catch { /* ignore */ }
    }

    if (okCount > 0) {
      await prisma.legalDocument.update({
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
      await jobs.enqueue('legal-vault-expiry', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    }
  } catch { /* ignore */ }

  return { ok: true, sent, checked: docs.length };
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('legal-vault-expiry', processLegalVaultExpiry);
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

async function ensureLegalVaultExpiryScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'legal-vault-expiry', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const tonight = new Date();
      tonight.setHours(2, 0, 0, 0);
      if (tonight.getTime() < Date.now()) tonight.setDate(tonight.getDate() + 1);
      await jobs.enqueue('legal-vault-expiry', {}, { runAt: tonight });
    }
  } catch (e) {
    console.error('[legal-vault-expiry] ensure schedule failed:', e.message);
  }
}

module.exports = { processLegalVaultExpiry, ensureLegalVaultExpiryScheduled, daysLeftOf };
