// Phase 56 Track 5: Rental Expiry & Renewal Alerts — daily job.
// Kaam:
//   * Rentals ending in <= 7 days (active) -> member + staff notification (dedupe per rental+endDate)
//   * Expired + autoRenew=true  -> endDate +1 month (auto-renew), member ko inform
//   * Expired + autoRenew=false -> status 'expired', locker wapas 'available', member + staff notify
//
// Coordinator wiring (server.js, ADDITIVE — is file me server.js nahi chhua):
//   require('./lib/lockerExpiry');
//   require('./lib/lockerExpiry').ensureLockerExpiryScheduled();
//
// Koi migration nahi — LockerRental/Locker Track 1+2 ke fragments se aate hain
// (merge na hue hon to graceful skip, koi crash nahi).

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');
const { createNotification } = require('./notify');

function getJobs() {
  try {
    return require('./jobs');
  } catch {
    return null;
  }
}

function daysLeftOf(endDate) {
  const ms = new Date(endDate).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// Dedupe marker — message prefix. endDate date-cycle shamil hai taake
// renewed rental ka naya cycle dobara notify ho sake (bina migration).
function expiryMarker(rentalId, endDate) {
  return `[locker-expiry:${rentalId}:${new Date(endDate).toISOString().slice(0, 10)}]`;
}

async function alreadyNotified(tenantId, rentalId, endDate) {
  try {
    const n = await prisma.notification.count({
      where: { tenantId, message: { startsWith: expiryMarker(rentalId, endDate) } },
    });
    return n > 0;
  } catch {
    return false;
  }
}

async function notifyMember(rental, message, html, subject) {
  // In-app (linked user ho to)
  const linkedUserId = rental.member && rental.member.user ? rental.member.user.id : null;
  if (linkedUserId) {
    try {
      await createNotification(prisma, {
        tenantId: rental.tenantId,
        userId: linkedUserId,
        type: 'contract_expiry',
        message,
      });
    } catch { /* ignore */ }
  }
  // Email
  if (rental.member && rental.member.email) {
    try {
      await sendEmail(rental.tenantId, { to: rental.member.email, subject, html });
    } catch (e) {
      console.error('[locker-expiry] email failed:', e.message);
    }
  }
}

async function notifyStaff(rental, message) {
  for (const r of ['ceo', 'admin', 'manager']) {
    try {
      await createNotification(prisma, {
        tenantId: rental.tenantId,
        role: r,
        type: 'contract_expiry',
        message,
      });
    } catch { /* ignore */ }
  }
}

async function fetchActiveRentals() {
  const base = {
    where: { status: 'active', endDate: { not: null } },
    include: {
      locker: { select: { id: true, code: true, status: true } },
      member: { select: { id: true, name: true, email: true, user: { select: { id: true } } } },
    },
  };
  try {
    return await prisma.lockerRental.findMany(base);
  } catch (e) {
    // Member.user relation purani schema me na ho -> bina user ke retry
    try {
      return await prisma.lockerRental.findMany({
        where: base.where,
        include: {
          locker: { select: { id: true, code: true, status: true } },
          member: { select: { id: true, name: true, email: true } },
        },
      });
    } catch (e2) {
      throw e2;
    }
  }
}

async function checkExpiries() {
  if (!prisma.lockerRental) {
    return { ok: false, reason: 'not_migrated' };
  }
  let rentals;
  try {
    rentals = await fetchActiveRentals();
  } catch (e) {
    console.error('[locker-expiry] locker_rentals not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }

  const stats = { checked: rentals.length, expiring: 0, expired: 0, renewed: 0, notified: 0 };

  for (const r of rentals) {
    const daysLeft = daysLeftOf(r.endDate);
    const code = r.locker ? r.locker.code : r.lockerId;
    const memberName = r.member ? r.member.name : 'Member';

    // ---- Expired ----
    if (daysLeft < 0) {
      if (r.autoRenew) {
        // Auto-renew: endDate + 1 month, rental active rehta hai
        const newEnd = new Date(r.endDate);
        newEnd.setMonth(newEnd.getMonth() + 1);
        try {
          await prisma.lockerRental.update({
            where: { id: r.id },
            data: { endDate: newEnd, status: 'active' },
          });
          stats.renewed += 1;
          const when = newEnd.toLocaleDateString();
          const msg = `✅ Locker ${code} auto-renew ho gaya hai (nayi expiry: ${when}).`;
          await notifyMember(
            r,
            `${expiryMarker(r.id, newEnd)} ${msg}`,
            `<p>Assalam-o-Alaikum ${memberName},</p><p>Aap ka locker <strong>${code}</strong> auto-renew ho gaya hai. Nayi expiry date: <strong>${when}</strong>.</p>`,
            `✅ Locker ${code} auto-renewed (new expiry: ${when})`
          );
        } catch (e) {
          console.error('[locker-expiry] renew failed', r.id, e.message);
        }
      } else {
        // Expired: rental close + locker available
        try {
          await prisma.$transaction([
            prisma.lockerRental.update({ where: { id: r.id }, data: { status: 'expired' } }),
            prisma.locker.update({ where: { id: r.lockerId }, data: { status: 'available' } }),
          ]);
          stats.expired += 1;
          const msg = `⛔ Locker ${code} ki rental expire ho gayi hai — locker ab available hai.`;
          await notifyMember(
            r,
            msg,
            `<p>Assalam-o-Alaikum ${memberName},</p><p>Aap ke locker <strong>${code}</strong> ki rental <strong style="color:#ef4444">expire ho gayi hai</strong>. Renew karne ke liye front desk se rabta karein.</p>`,
            `⛔ Locker ${code} rental expired`
          );
          await notifyStaff(r, `⛔ Locker ${code} (${memberName}) expire — available kar diya gaya.`);
        } catch (e) {
          console.error('[locker-expiry] expire failed', r.id, e.message);
        }
      }
      continue;
    }

    // ---- Ending within 7 days ----
    if (daysLeft <= 7) {
      stats.expiring += 1;
      const dup = await alreadyNotified(r.tenantId, r.id, r.endDate);
      if (dup) continue;
      const marker = expiryMarker(r.id, r.endDate);
      const dayWord = daysLeft === 0 ? 'aaj' : daysLeft === 1 ? '1 din' : `${daysLeft} din`;
      const msg = `${marker} 🔔 Locker ${code} ki rental ${dayWord} me khatam ho rahi hai (${memberName}).`;
      await notifyMember(
        r,
        msg,
        `<p>Assalam-o-Alaikum ${memberName},</p><p>Aap ke locker <strong>${code}</strong> ki rental <strong>${dayWord}</strong> me khatam ho rahi hai (expiry: ${new Date(r.endDate).toLocaleDateString()}).</p><p>Renew karne ke liye front desk se rabta karein.</p>`,
        `🔔 Locker ${code} rental ending in ${dayWord}`
      );
      await notifyStaff(r, `🔔 Locker ${code} (${memberName}) ${dayWord} me expire ho raha hai.`);
      stats.notified += 1;
    }
  }

  // Khud ko kal ke liye dobara schedule karo (nightly self-rescheduling).
  try {
    const jobs = getJobs();
    if (jobs) {
      await jobs.enqueue('locker-expiry', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    }
  } catch { /* ignore */ }

  return { ok: true, ...stats };
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('locker-expiry', checkExpiries);
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

// Boot par ensure karo ke daily run scheduled hai (backup.js wala pattern).
async function ensureLockerExpiryScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'locker-expiry', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const tonight = new Date();
      tonight.setHours(2, 0, 0, 0);
      if (tonight.getTime() < Date.now()) tonight.setDate(tonight.getDate() + 1);
      await jobs.enqueue('locker-expiry', {}, { runAt: tonight });
    }
  } catch (e) {
    console.error('[locker-expiry] ensure schedule failed:', e.message);
  }
}

module.exports = { checkExpiries, ensureLockerExpiryScheduled, daysLeftOf };
