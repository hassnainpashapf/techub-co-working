// Phase 32 Track 6: Login Security helpers — IP allowlist + new-device alerts.
// Used as a hook from routes/auth.js after successful password verification.
// Never throws: all DB/email work is fire-and-forget so login can't break.

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

const ALLOWLIST_KEY = 'ipAllowlist';
const SEEN_WINDOW_DAYS = 90;

// Basic IPv4 / IPv6 validation (optionally with CIDR suffix).
function isValidIpEntry(s) {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  const v4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(\/([0-9]|[12][0-9]|3[0-2]))?$/;
  const v6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))?$/;
  return v4.test(v) || v6.test(v);
}

// Parse the tenant's ipAllowlist setting → array of strings. Missing/empty = disabled.
async function getIpAllowlist(tenantId) {
  try {
    const row = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: ALLOWLIST_KEY } },
    });
    if (!row || !row.value) return [];
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch (_e) {
    return [];
  }
}

function ipMatches(ip, entry) {
  const e = String(entry).trim();
  // Exact match
  if (e === ip) return true;
  // CIDR (IPv4 only for simplicity)
  if (e.includes('/')) {
    const [base, bitsStr] = e.split('/');
    const bits = parseInt(bitsStr, 10);
    const toInt = (s) => s.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10), 0) >>> 0;
    try {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (toInt(base) & mask) === (toInt(ip) & mask);
    } catch (_err) {
      return false;
    }
  }
  return false;
}

// Allowlist enforcement — called after password success, before issuing tokens.
// Returns { allowed: true } when allowlist is empty (disabled) or ip matches.
async function checkIpAllowed(tenantId, ip) {
  const allowlist = await getIpAllowlist(tenantId);
  if (!allowlist.length) return { allowed: true, allowlist };
  const allowed = allowlist.some((entry) => ipMatches(ip, entry));
  return { allowed, allowlist };
}

// Record a blocked-IP attempt as an alert (for admin visibility).
async function recordBlockedIp(tenantId, user, ip, userAgent) {
  try {
    await prisma.loginAlert.create({
      data: {
        tenantId,
        userId: user.id,
        ipAddress: ip || 'unknown',
        userAgent: (userAgent || '').slice(0, 1000),
        type: 'blocked_ip',
      },
    });
  } catch (_e) { /* never break login */ }
}

// New-device / suspicious detection + email. Fire-and-forget from auth.js.
async function trackLogin(tenantId, user, ip, userAgent) {
  try {
    const clientIp = ip || 'unknown';
    const since = new Date(Date.now() - SEEN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const seen = await prisma.loginAlert.findFirst({
      where: { tenantId, userId: user.id, ipAddress: clientIp, createdAt: { gte: since } },
    });
    if (seen) return { alerted: false }; // known IP — nothing to do

    // suspicious: another new-device alert for this user within last 24h from a different IP
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentOther = await prisma.loginAlert.findFirst({
      where: {
        tenantId,
        userId: user.id,
        type: { in: ['new_device', 'suspicious'] },
        ipAddress: { not: clientIp },
        createdAt: { gte: dayAgo },
      },
    });
    const type = recentOther ? 'suspicious' : 'new_device';
    await prisma.loginAlert.create({
      data: {
        tenantId,
        userId: user.id,
        ipAddress: clientIp,
        userAgent: (userAgent || '').slice(0, 1000),
        type,
      },
    });

    // Email the user (queued via mailer job queue)
    if (user.email) {
      const when = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
      const ua = (userAgent || 'unknown device').slice(0, 120);
      const subject = type === 'suspicious'
        ? 'Suspicious login to your Techub account'
        : 'New login to your Techub account';
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
          <h2 style="color:${type === 'suspicious' ? '#b91c1c' : '#1d4ed8'}">${subject}</h2>
          <p>Hi ${user.name || 'there'},</p>
          <p>We noticed a ${type === 'suspicious' ? '<b>suspicious</b>' : 'new'} sign-in to your account:</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 12px;color:#64748b">IP address</td><td style="padding:6px 12px"><b>${clientIp}</b></td></tr>
            <tr><td style="padding:6px 12px;color:#64748b">Device</td><td style="padding:6px 12px">${ua}</td></tr>
            <tr><td style="padding:6px 12px;color:#64748b">Time</td><td style="padding:6px 12px">${when}</td></tr>
          </table>
          <p>If this was you, no action is needed. If not, please change your password immediately and contact your administrator.</p>
        </div>`;
      sendEmail(tenantId, { to: user.email, subject, html }).catch(() => {});
    }
    return { alerted: true, type };
  } catch (_e) {
    return { alerted: false };
  }
}

module.exports = {
  ALLOWLIST_KEY,
  isValidIpEntry,
  getIpAllowlist,
  checkIpAllowed,
  recordBlockedIp,
  trackLogin,
};
