// Phase 48 Track 7/10: Access Anomaly Alerts — entry/exit anomaly detection.
//
// Coordinator wiring (server.js — main agent/coordinator karega):
//   require('./lib/accessAnomalies'); // auto-register handler
//   require('./lib/accessAnomalies').ensureAccessAnomaliesScheduled();
//
// Manual trigger (coordinator route me jode, e.g. routes/access-logs.js):
//   POST /api/access-logs/scan (ceo/admin) ->
//     await require('../lib/accessAnomalies').scanAllTenants()
//
// Job: har 15 min me har active tenant par 4 detectors:
//   1. after_hours_entry   — schedule ke bahar granted entry (Track 4 accessCheck)
//   2. denied_burst        — 5+ denied attempts 10 min me (per member, brute/tailgating)
//   3. door_forced         — ek door par 10+ denied 10 min me (member-independent)
//   4. inactive_member     — inactive/suspended member ki entry attempt
// Alert -> Notification (ceo/admin/manager/ops) + optional email. Dedupe daily per member+type.

const prisma = require('./prisma');

const MIN15 = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function getJobs() {
  try { return require('./jobs'); } catch { return null; }
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function num(v) { return Number(v || 0); }

// Ek tenant ke liye tamam detectors. Returns: naye alerts ki list.
async function detectForTenant(tenantId) {
  // Track 3 ka AccessLog model merge na ho to gracefully skip (koi crash nahi).
  if (!prisma.accessLog) return { ok: false, reason: 'not_migrated', alerts: [] };

  const alerts = [];
  const now = new Date();
  const today = todayKey(now);
  const windowStart = new Date(now.getTime() - 30 * 60 * 1000); // pichhle 30 min ke logs scan karo
  const burstStart = new Date(now.getTime() - 10 * 60 * 1000);

  const push = (type, key2, severity, title, detail) =>
    alerts.push({ key: `[access-anomaly:${type}:${key2}:${today}]`, severity, title, detail });

  // 1) After-hours entry — granted log jahan Track 4 ka canEnter rokta.
  try {
    let canEnter = null;
    try { ({ canEnter } = require('./accessCheck')); } catch { canEnter = null; }
    if (typeof canEnter === 'function') {
      const granted = await prisma.accessLog.findMany({
        where: { tenantId, result: 'granted', createdAt: { gte: windowStart }, memberId: { not: null } },
        select: { id: true, memberId: true, doorId: true, createdAt: true },
        take: 500,
      });
      const seen = new Set();
      for (const g of granted) {
        if (seen.has(g.memberId)) continue;
        try {
          const r = await canEnter(tenantId, g.memberId, g.doorId, g.createdAt);
          if (r && r.allowed === false) {
            seen.add(g.memberId);
            push('after_hours_entry', g.memberId, 'warning',
              'After-hours entry',
              `Member ${g.memberId} ne schedule ke bahar entry li (door ${g.doorId}, ${new Date(g.createdAt).toLocaleString('en-PK')}) — wajah: ${r.reason || 'schedule mismatch'}.`);
          }
        } catch { /* ek check fail ho to baqi chalte rahein */ }
      }
    }
  } catch (e) { console.error('[access-anomaly] after_hours failed:', e.message); }

  // 2) Denied burst — 5+ denied attempts 10 min me (per member).
  try {
    const denied = await prisma.accessLog.findMany({
      where: { tenantId, result: 'denied', createdAt: { gte: burstStart }, memberId: { not: null } },
      select: { memberId: true, doorId: true },
    });
    const byMember = {};
    for (const d of denied) {
      const k = d.memberId;
      byMember[k] = byMember[k] || { count: 0, doors: new Set() };
      byMember[k].count += 1;
      byMember[k].doors.add(d.doorId);
    }
    for (const [memberId, s] of Object.entries(byMember)) {
      if (s.count >= 5) {
        push('denied_burst', memberId, 'critical',
          'Repeated denied entry attempts',
          `Member ${memberId} ki ${s.count} denied attempts pichhle 10 min me (${s.doors.size} door) — possible tailgating ya brute force.`);
      }
    }
  } catch (e) { console.error('[access-anomaly] denied_burst failed:', e.message); }

  // 3) Door forced — ek door par 10+ denied 10 min me (member-independent, unknown card).
  try {
    const denied = await prisma.accessLog.findMany({
      where: { tenantId, result: 'denied', createdAt: { gte: burstStart } },
      select: { doorId: true },
    });
    const byDoor = {};
    for (const d of denied) byDoor[d.doorId] = (byDoor[d.doorId] || 0) + 1;
    for (const [doorId, n] of Object.entries(byDoor)) {
      if (n >= 10) {
        push('door_forced', doorId, 'critical',
          'Door under attack / forced attempts',
          `Door ${doorId} par ${n} denied attempts pichhle 10 min me — check karein (unknown card ya forced entry).`);
      }
    }
  } catch (e) { console.error('[access-anomaly] door_forced failed:', e.message); }

  // 4) Inactive member attempt — status active na ho.
  try {
    const attempts = await prisma.accessLog.findMany({
      where: { tenantId, createdAt: { gte: windowStart }, memberId: { not: null } },
      select: { memberId: true, doorId: true, result: true, createdAt: true },
      take: 500,
    });
    const memberIds = [...new Set(attempts.map((a) => a.memberId))];
    if (memberIds.length && prisma.member) {
      const members = await prisma.member.findMany({
        where: { tenantId, id: { in: memberIds } },
        select: { id: true, name: true, status: true },
      }).catch(() => []);
      const inactive = new Map();
      for (const m of members) {
        if (m.status && !['active', 'ACTIVE'].includes(String(m.status))) {
          inactive.set(m.id, m);
        }
      }
      const seen = new Set();
      for (const a of attempts) {
        const m = inactive.get(a.memberId);
        if (m && !seen.has(m.id)) {
          seen.add(m.id);
          push('inactive_member', m.id, 'warning',
            'Inactive member entry attempt',
            `Member "${m.name || m.id}" (status: ${m.status}) ne entry ki koshish ki (door ${a.doorId}, result: ${a.result}).`);
        }
      }
    }
  } catch (e) { console.error('[access-anomaly] inactive_member failed:', e.message); }

  // Dedupe + alert dispatch: notification (ceo/admin/manager/ops) + optional email.
  const sent = [];
  for (const a of alerts) {
    const dup = await prisma.notification.count({
      where: { tenantId, message: { startsWith: a.key } },
    }).catch(() => 1);
    if (dup > 0) continue; // ye alert aaj pehle bheja ja chuka

    const fullMsg = `${a.key} ${a.title}: ${a.detail}`;
    for (const role of ['ceo', 'admin', 'manager', 'ops']) {
      await prisma.notification.create({
        data: { tenantId, role, type: 'general', message: fullMsg },
      }).catch(() => {});
    }
    sent.push(a);

    try {
      const { sendEmail } = require('./mailer');
      const admins = await prisma.user.findMany({
        where: { tenantId, role: { in: ['ceo', 'admin'] }, isActive: true, email: { not: null } },
        select: { email: true },
      }).catch(() => []);
      const to = [...new Set(admins.map((u) => u.email).filter(Boolean))];
      if (to.length && typeof sendEmail === 'function') {
        await sendEmail({
          tenantId,
          to,
          subject: `🚨 ${a.title} — access anomaly`,
          html: `<p>${a.detail}</p><p>Techub access anomaly detector ne ye alert auto-generate kiya hai.</p>`,
        }).catch(() => {});
      }
    } catch { /* email optional */ }
  }

  return { ok: true, alerts: sent.map((a) => ({ key: a.key, severity: a.severity, title: a.title })) };
}

// Saare active tenants par scan (job handler + manual trigger dono se).
async function scanAllTenants() {
  try {
    const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } }).catch(() => []);
    let total = 0;
    for (const t of tenants) {
      const r = await detectForTenant(t.id).catch(() => null);
      if (r) total += (r.alerts || []).length;
    }
    // Khud ko 15 min baad dobara schedule karo.
    try {
      const jobs = getJobs();
      if (jobs) await jobs.enqueue('access-anomaly-scan', {}, { runAt: new Date(Date.now() + MIN15) });
    } catch { /* ignore */ }
    return { ok: true, tenants: tenants.length, alerts: total };
  } catch (e) {
    console.error('[access-anomaly] scanAllTenants failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('access-anomaly-scan', scanAllTenants);
    }
  } catch { /* jobs module not present — coordinator merges it later */ }
})();

// Boot par ensure karo ke 15-min scan scheduled hai.
async function ensureAccessAnomaliesScheduled() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'access-anomaly-scan', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      await jobs.enqueue('access-anomaly-scan', {}, { runAt: new Date(Date.now() + MIN15) });
    }
  } catch (e) {
    console.error('[access-anomaly] ensure schedule failed:', e.message);
  }
}

module.exports = { detectForTenant, scanAllTenants, ensureAccessAnomaliesScheduled };
