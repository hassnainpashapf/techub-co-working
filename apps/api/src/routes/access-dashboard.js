// Phase 48 Track 10/10: Access Dashboard — stats + live feed + who's-in.
// Coordinator ke liye:
//   Mount: app.use('/api/access-dashboard', require('./routes/access-dashboard'));
//   Sidebar link: { label: 'Access', path: '/access' } — roles: ceo/admin/super_admin/manager/ops
//   Schema merge: tracks 1-9 ke models (Door, AccessLog, AccessCredential, DayPass).
//   Har section defensive hai — model merge na hua ho to wo section null, poora endpoint 200 rehta hai.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager', 'ops'));

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function h24Ago() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

// GET /api/access-dashboard/stats
router.get('/stats', async (req, res) => {
  const tf = tenantFilter(req);
  const today = startOfToday();
  const out = { migrated: {}, missing: [] };

  // Entries today (granted + in)
  if (prisma.accessLog) {
    try {
      out.migrated.accessLog = true;
      const [entriesToday, deniedToday] = await Promise.all([
        prisma.accessLog.count({ where: { ...tf, result: 'granted', direction: 'in', createdAt: { gte: today } } }),
        prisma.accessLog.count({ where: { ...tf, result: 'denied', createdAt: { gte: today } } }),
      ]);
      out.entriesToday = entriesToday;
      out.deniedToday = deniedToday;
    } catch { out.entriesToday = null; out.deniedToday = null; }
  } else { out.missing.push('accessLog'); out.entriesToday = null; out.deniedToday = null; }

  // Active credentials
  if (prisma.accessCredential) {
    try {
      out.migrated.accessCredential = true;
      out.activeCredentials = await prisma.accessCredential.count({ where: { ...tf, isActive: true } });
    } catch { out.activeCredentials = null; }
  } else { out.missing.push('accessCredential'); out.activeCredentials = null; }

  // Active doors
  if (prisma.door) {
    try {
      out.migrated.door = true;
      out.activeDoors = await prisma.door.count({ where: { ...tf, isActive: true } });
    } catch { out.activeDoors = null; }
  } else { out.missing.push('door'); out.activeDoors = null; }

  // Pending visitor passes (member-requested, reception approval baqi)
  if (prisma.dayPass) {
    try {
      out.migrated.dayPass = true;
      out.pendingPasses = await prisma.dayPass.count({ where: { ...tf, status: 'pending' } });
    } catch { out.pendingPasses = null; }
  } else { out.missing.push('dayPass'); out.pendingPasses = null; }

  // Access anomalies (24h) — track 7 ki lib Notification me alert bhejti hai
  if (prisma.notification) {
    try {
      const since = h24Ago();
      out.anomalies24h = await prisma.notification.count({
        where: {
          ...tf,
          createdAt: { gte: since },
          OR: [
            { message: { contains: 'access-anomaly', mode: 'insensitive' } },
            { title: { contains: 'access', mode: 'insensitive' } },
          ],
        },
      });
    } catch { out.anomalies24h = null; }
  } else { out.anomalies24h = null; }

  res.json({ ok: true, stats: out });
});

// GET /api/access-dashboard/live — last 20 events + who's in building
router.get('/live', async (req, res) => {
  const tf = tenantFilter(req);
  if (!prisma.accessLog) return res.json({ ok: true, events: [], inside: [], missing: ['accessLog'] });

  try {
    const today = startOfToday();
    const events = await prisma.accessLog.findMany({
      where: tf,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        ...(prisma.door ? { door: { select: { name: true } } } : {}),
        ...(prisma.member ? { member: { select: { name: true } } } : {}),
      },
    });

    // Who's in: aaj ke granted in/out events se — jis ka aakhri event 'in' granted ho
    const dayLogs = await prisma.accessLog.findMany({
      where: { ...tf, createdAt: { gte: today }, memberId: { not: null } },
      orderBy: { createdAt: 'asc' },
      take: 2000,
      select: { memberId: true, direction: true, result: true, createdAt: true, doorId: true },
    });
    const last = {};
    for (const l of dayLogs) last[l.memberId] = l;
    const insideIds = Object.entries(last)
      .filter(([, l]) => l.direction === 'in' && l.result === 'granted')
      .map(([id]) => id);

    let inside = [];
    if (insideIds.length && prisma.member) {
      inside = await prisma.member.findMany({
        where: { ...tf, id: { in: insideIds } },
        select: { id: true, name: true, phone: true },
      });
      // har inside member ki entry time jor do
      const inTime = {};
      for (const l of dayLogs) if (insideIds.includes(l.memberId) && l.direction === 'in' && l.result === 'granted') inTime[l.memberId] = l.createdAt;
      inside = inside.map((m) => ({ ...m, enteredAt: inTime[m.id] || null }));
    }

    res.json({
      ok: true,
      events: events.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        direction: e.direction,
        result: e.result,
        credentialType: e.credentialType,
        reason: e.reason,
        door: e.door ? e.door.name : null,
        member: e.member ? e.member.name : null,
      })),
      inside,
      insideCount: inside.length,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Live feed load nahi hua.' });
  }
});

module.exports = router;
