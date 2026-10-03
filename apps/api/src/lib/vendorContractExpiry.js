// Phase 41 Track 9: Vendor contract expiry tracking — daily job.
// Coordinator wiring: server.js me `require('./lib/vendorContractExpiry');`
// taake handler auto-register ho jaye + `ensureVendorContractExpiryScheduled()` call ho.
//
// Job har active vendor contract ke liye:
//   * daysLeft <= reminderDays ho to admin ko email + in-app notification (dedupe lastReminderKey se)
//   * daysLeft < 0 ho to status -> expired + renewal Task create (ek dafa, lastReminderKey se dedupe)

const prisma = require('./prisma');
const { sendEmail, getTenantBrand } = require('./mailer');
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

function daysLeftOf(endDate) {
  const ms = new Date(endDate).getTime() - Date.now();
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

async function processVendorContractExpiry(payload = {}) {
  if (!prisma.vendorContract) {
    console.error('[vendor-contract-expiry] VendorContract model not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }
  let contracts;
  try {
    contracts = await prisma.vendorContract.findMany({
      where: { status: 'active' },
      include: { vendor: { select: { id: true, name: true, email: true } } },
    });
  } catch (e) {
    console.error('[vendor-contract-expiry] vendor_contracts table not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }

  let reminded = 0;
  let expired = 0;

  for (const c of contracts) {
    const daysLeft = daysLeftOf(c.endDate);
    const keyBase = new Date(c.endDate).toISOString();

    if (daysLeft < 0) {
      // Expired — ek dafa status change + renewal task.
      if (c.lastReminderKey === `${keyBase}:expired`) continue;
      await prisma.vendorContract.update({
        where: { id: c.id },
        data: { status: 'expired', lastReminderKey: `${keyBase}:expired` },
      });
      expired++;

      const admins = await tenantAdmins(c.tenantId);
      const autoNote = c.autoRenew ? ' (contract me auto-renew ON tha — vendor se confirm karein)' : '';
      const title = `Renew vendor contract: ${c.title}`;
      const desc = `Vendor: ${c.vendor?.name || '—'}\nContract "${c.title}" ${new Date(c.endDate).toISOString().slice(0, 10)} ko expire ho gaya hai${autoNote}.\nValue: ${c.value != null ? Number(c.value) : '—'}`;

      for (const role of ['ceo', 'admin', 'manager']) {
        await createNotification(prisma, {
          tenantId: c.tenantId,
          role,
          type: 'vendor_contract_expired',
          message: `📋 ${c.vendor?.name || 'Vendor'} ka contract "${c.title}" expire ho gaya hai. Renewal task bana di gayi hai.`,
        });
      }

      const owner = admins[0];
      if (owner) {
        try {
          await prisma.task.create({
            data: {
              tenantId: c.tenantId,
              title,
              description: desc,
              assigneeId: owner.id,
              createdById: owner.id,
              priority: 'high',
            },
          });
        } catch (e) {
          console.error('[vendor-contract-expiry] task create failed', e.message);
        }
        // Renewal task ki email admin ko
        try {
          const brand = await getTenantBrand(c.tenantId);
          await sendEmail(c.tenantId, {
            to: owner.email,
            subject: `[${brand?.brandName || 'CoworkOS'}] Vendor contract expired — ${c.title}`,
            html: `<p>Salam ${owner.name || 'Admin'},</p>
              <p>Vendor <b>${c.vendor?.name || '—'}</b> ka contract <b>"${c.title}"</b> expire ho gaya hai (${new Date(c.endDate).toISOString().slice(0, 10)}).</p>
              <p>Ek renewal task system me bana di gayi hai. Contract renew ya renegotiate karein.</p>`,
            text: `Vendor ${c.vendor?.name || ''} ka contract "${c.title}" expire ho gaya hai. Renewal task bana di gayi hai.`,
          });
        } catch (e) {
          console.error('[vendor-contract-expiry] expired email failed', e.message);
        }
      }
      continue;
    }

    // Expiry reminder window
    const window_ = Number(c.reminderDays ?? 30);
    if (daysLeft <= window_ && c.lastReminderKey !== `${keyBase}:${window_}`) {
      await prisma.vendorContract.update({
        where: { id: c.id },
        data: { lastReminderKey: `${keyBase}:${window_}` },
      });
      reminded++;

      const admins = await tenantAdmins(c.tenantId);
      const msg = `⏰ "${c.title}" (${c.vendor?.name || 'vendor'}) ka contract ${daysLeft} din me expire hoga (${new Date(c.endDate).toISOString().slice(0, 10)}).`;
      for (const role of ['ceo', 'admin', 'manager']) {
        await createNotification(prisma, {
          tenantId: c.tenantId,
          role,
          type: 'vendor_contract_expiring',
          message: msg,
        });
      }
      const owner = admins[0];
      if (owner) {
        try {
          const brand = await getTenantBrand(c.tenantId);
          await sendEmail(c.tenantId, {
            to: owner.email,
            subject: `[${brand?.brandName || 'CoworkOS'}] Contract expiring in ${daysLeft} days — ${c.title}`,
            html: `<p>Salam ${owner.name || 'Admin'},</p>
              <p>Vendor <b>${c.vendor?.name || '—'}</b> ka contract <b>"${c.title}"</b> <b>${daysLeft} din</b> me expire hoga (${new Date(c.endDate).toISOString().slice(0, 10)}).</p>
              <p>Value: ${c.value != null ? Number(c.value) : '—'}${c.autoRenew ? ' • Auto-renew ON' : ''}</p>
              <p>Waqt par renew/renegotiate kar lein.</p>`,
            text: `Vendor ${c.vendor?.name || ''} ka contract "${c.title}" ${daysLeft} din me expire hoga.`,
          });
        } catch (e) {
          console.error('[vendor-contract-expiry] reminder email failed', e.message);
        }
      }
    }
  }

  return { ok: true, checked: contracts.length, reminded, expired };
}

function ensureVendorContractExpiryScheduled() {
  const jobs = getJobs();
  if (!jobs) return false;
  if (typeof jobs.registerHandler === 'function') {
    jobs.registerHandler('vendor-contract-expiry', processVendorContractExpiry);
  }
  if (typeof jobs.enqueue === 'function') {
    try {
      jobs.enqueue('vendor-contract-expiry', {}, { delayMs: 10 * 1000 });
      // Daily reschedule — docExpiryJob wala pattern
      const DAY = 24 * 60 * 60 * 1000;
      setInterval(() => {
        try {
          jobs.enqueue('vendor-contract-expiry', {});
        } catch {}
      }, DAY);
    } catch {}
  }
  return true;
}

module.exports = {
  processVendorContractExpiry,
  ensureVendorContractExpiryScheduled,
};
