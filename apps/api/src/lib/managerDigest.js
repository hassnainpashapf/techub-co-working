// Phase 45 Track 9: Daily Manager Digest — subah 8 baje ceo/admin/manager ko
// kal/aaj ke key numbers ka smart summary email.
//
// Coordinator wiring:
//   server.js me:  require('./lib/managerDigest');
//                  require('./lib/managerDigest').ensureDigestScheduled();
//   Preview/test route (coordinator jode — koi route maine nahi banaya):
//     GET  /api/manager-digest/preview  (ceo/admin) -> buildDigest(tenantId)
//     POST /api/manager-digest/test { email } -> sendTestDigest(tenantId, email)
// Timezone: Tenant par timezone field nahi — Setting 'general.timezone' se
// override, default 'Asia/Karachi' (user ka timezone).

const prisma = require('./prisma');
const { sendEmail, notify, getTenantBrand } = require('./mailer');

function getJobs() {
  try {
    return require('./jobs');
  } catch {
    return null;
  }
}

const DEFAULT_TZ = 'Asia/Karachi';

async function tenantTimezone(tenantId) {
  try {
    const row = await prisma.setting.findFirst({
      where: { tenantId, key: 'general.timezone' },
      select: { value: true },
    });
    if (row && row.value) return String(row.value);
  } catch { /* ignore */ }
  return DEFAULT_TZ;
}

// "Kal" ka range tenant timezone me — simple approach: UTC day boundaries.
function dayRange(offsetDays = 1) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - offsetDays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function fmtRs(n) {
  return `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// --- Digest data gather (sirf read; koi mutation nahi) ---
async function buildDigest(tenantId) {
  const tf = { tenantId };
  const { start: yStart, end: yEnd } = dayRange(1);   // kal
  const { start: tStart } = dayRange(0);              // aaj
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const d = { tenantId, generatedAt: now.toISOString() };

  // 1. Revenue collected kal (payments)
  try {
    const rows = await prisma.payment.findMany({
      where: { ...tf, paidAt: { gte: yStart, lt: yEnd } },
      select: { amount: true },
    });
    d.revenueYesterday = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    d.paymentsYesterday = rows.length;
  } catch { d.revenueYesterday = 0; d.paymentsYesterday = 0; }

  // 2. Nayi bookings kal
  try {
    d.newBookings = await prisma.booking.count({
      where: { ...tf, createdAt: { gte: yStart, lt: yEnd }, status: { not: 'cancelled' } },
    });
  } catch { d.newBookings = 0; }

  // 3. Staff check-ins aaj
  try {
    d.checkinsToday = await prisma.attendanceRecord.count({
      where: { ...tf, date: { gte: tStart }, checkIn: { not: null } },
    });
  } catch { d.checkinsToday = 0; }

  // 4. Open support tickets
  try {
    d.openTickets = await prisma.ticket.count({
      where: { ...tf, status: { in: ['open', 'in_progress', 'on_hold'] } },
    });
  } catch { d.openTickets = 0; }

  // 5. Overdue invoices (unpaid/partial + dueDate guzar chuki)
  try {
    const inv = await prisma.invoice.findMany({
      where: { ...tf, status: { in: ['unpaid', 'partially_paid', 'overdue'] }, dueDate: { lt: tStart } },
      select: { amount: true, amountPaid: true },
    });
    d.overdueInvoices = inv.length;
    d.overdueAmount = inv.reduce((s, r) => s + (Number(r.amount || 0) - Number(r.amountPaid || 0)), 0);
  } catch { d.overdueInvoices = 0; d.overdueAmount = 0; }

  // 6. Unread insights (Track 4 merge na hua ho to gracefully 0)
  try {
    d.unreadInsights = prisma.insight
      ? await prisma.insight.count({ where: { ...tf, isRead: false } })
      : 0;
  } catch { d.unreadInsights = 0; }

  // 7. Recent anomalies — Track 5 notifications me likhta hai (message me 'anomal'/'spike')
  d.anomalies = [];
  try {
    const notifs = await prisma.notification.findMany({
      where: { ...tf, createdAt: { gte: yStart } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { message: true, createdAt: true },
    });
    d.anomalies = notifs
      .filter((n) => /anomal|spike|surge|dip/i.test(n.message || ''))
      .slice(0, 5)
      .map((n) => ({ message: n.message, at: n.createdAt }));
  } catch { d.anomalies = []; }

  // 8. Upcoming events (7 din)
  d.upcomingEvents = [];
  try {
    const evs = await prisma.communityEvent.findMany({
      where: { ...tf, startsAt: { gte: now, lt: in7d }, status: { not: 'cancelled' } },
      orderBy: { startsAt: 'asc' },
      take: 5,
      select: { title: true, startsAt: true, location: true },
    });
    d.upcomingEvents = evs.map((e) => ({ title: e.title, when: fmtDate(e.startsAt), location: e.location }));
  } catch { d.upcomingEvents = []; }

  return d;
}

function digestHtml(brandName, dateLine, d) {
  const row = (label, value, warn) =>
    `<tr><td style="padding:8px 12px;color:#cbd5e1;">${label}</td><td style="padding:8px 12px;text-align:right;font-weight:700;color:${warn ? '#fbbf24' : '#fff'};">${value}</td></tr>`;
  const anomalies = d.anomalies.length
    ? `<ul style="margin:4px 0;padding-left:18px;color:#fbbf24;">${d.anomalies.map((a) => `<li>${a.message}</li>`).join('')}</ul>`
    : `<p style="color:#64748b;">Koi anomaly detect nahi hui. ✅</p>`;
  const events = d.upcomingEvents.length
    ? `<ul style="margin:4px 0;padding-left:18px;color:#cbd5e1;">${d.upcomingEvents.map((e) => `<li><b>${e.title}</b> — ${e.when}${e.location ? ` @ ${e.location}` : ''}</li>`).join('')}</ul>`
    : `<p style="color:#64748b;">Agley 7 din me koi event nahi.</p>`;
  return `
    <p style="color:#94a3b8;">${dateLine} — ${brandName} ki daily summary:</p>
    <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;">
      ${row('💰 Revenue collected (kal)', fmtRs(d.revenueYesterday) + ` (${d.paymentsYesterday} payments)`)}
      ${row('📅 Nayi bookings (kal)', d.newBookings)}
      ${row('🟢 Staff check-ins (aaj)', d.checkinsToday)}
      ${row('🎫 Open support tickets', d.openTickets, d.openTickets > 5)}
      ${row('⚠️ Overdue invoices', `${d.overdueInvoices} — ${fmtRs(d.overdueAmount)}`, d.overdueInvoices > 0)}
      ${row('💡 Unread AI insights', d.unreadInsights, d.unreadInsights > 0)}
    </table>
    <h4 style="color:#fff;margin:16px 0 4px;">🚨 Anomalies (24h)</h4>${anomalies}
    <h4 style="color:#fff;margin:16px 0 4px;">🎪 Upcoming events (7 din)</h4>${events}
    <p style="color:#64748b;font-size:12px;margin-top:16px;">Ye digest automatically generate hua hai. Details ke liye dashboard kholen.</p>`;
}

async function alreadySentToday(tenantId) {
  const { start } = dayRange(0);
  try {
    const n = await prisma.auditLog.count({
      where: { tenantId, action: 'digest.sent', createdAt: { gte: start } },
    });
    return n > 0;
  } catch { return false; }
}

async function markSent(tenantId, recipients) {
  try {
    await prisma.auditLog.create({
      data: { tenantId, action: 'digest.sent', entity: 'digest', newValue: { recipients }, actorId: null },
    });
  } catch { /* ignore */ }
}

// --- Main job: tamam active tenants ko digest ---
async function sendDailyDigest() {
  let tenants = [];
  try {
    tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  } catch (e) {
    return { ok: false, reason: 'tenant_query_failed' };
  }
  let sent = 0, skipped = 0;
  for (const t of tenants) {
    try {
      if (await alreadySentToday(t.id)) { skipped++; continue; }
      const recipients = await prisma.user.findMany({
        where: { tenantId: t.id, role: { in: ['ceo', 'admin', 'manager'] }, isActive: true, email: { not: null } },
        select: { name: true, email: true },
      });
      if (!recipients.length) { skipped++; continue; }
      const tz = await tenantTimezone(t.id);
      const brand = await getTenantBrand(t.id).catch(() => ({ brandName: t.name }));
      const digest = await buildDigest(t.id);
      const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
      for (const r of recipients) {
        try {
          await notify(t.id, r.email, 'managerDigest', {
            name: r.name || 'Manager',
            dateLine,
            summaryHtml: digestHtml(brand.brandName || t.name, dateLine, digest),
          });
          sent++;
        } catch (e) {
          console.error(`[manager-digest] send failed ${r.email}:`, e.message);
        }
      }
      await markSent(t.id, recipients.length);
    } catch (e) {
      console.error(`[manager-digest] tenant ${t.id} failed:`, e.message);
    }
  }
  return { ok: true, sent, skipped, tenants: tenants.length };
}

// Test/preview: ek email par digest bhejo (coordinator route se wire kare).
async function sendTestDigest(tenantId, email) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const brand = await getTenantBrand(tenantId).catch(() => ({ brandName: t?.name || 'CoworkOS' }));
  const digest = await buildDigest(tenantId);
  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: DEFAULT_TZ });
  return sendEmail(tenantId, {
    to: email,
    subject: `Manager digest (test) — ${dateLine}`,
    html: `<p>Hi Manager,</p>${digestHtml(brand.brandName || t?.name || 'CoworkOS', dateLine, digest)}`,
  });
}

// Auto-register + daily schedule (eventEmails.js wala pattern).
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('manager-digest', async () => sendDailyDigest());
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

async function ensureDigestScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'manager-digest', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      const morning = new Date();
      morning.setHours(8, 0, 0, 0);
      if (morning.getTime() < Date.now()) morning.setDate(morning.getDate() + 1);
      await jobs.enqueue('manager-digest', {}, { runAt: morning });
    }
  } catch (e) {
    console.error('[manager-digest] ensure schedule failed:', e.message);
  }
}

module.exports = { buildDigest, sendDailyDigest, sendTestDigest, ensureDigestScheduled };
