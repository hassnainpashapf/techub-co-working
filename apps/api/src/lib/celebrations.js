// Phase 40 Track 1: Birthday & Anniversary automation — daily job.
// Coordinator wiring (server.js, additive):
//   require('./lib/celebrations');                       // 'celebrations' handler auto-register
//   require('./lib/celebrations').ensureCelebrationsScheduled();  // daily self-schedule
// ya daily PHASE job list me 'celebrations' add kar dein.

const prisma = require('./prisma');
const { notify } = require('./mailer');
const { createNotification } = require('./notify');

const BIRTHDAY_POINTS = 50;
const ANNIVERSARY_POINTS = 100;

function getJobs() {
  try {
    return require('./jobs');
  } catch {
    return null;
  }
}

// dateOfBirth merge na hua ho to gracefully skip (503-guard jaisa)
function schemaReady() {
  try {
    return typeof prisma.celebrationLog !== 'undefined' && typeof prisma.celebrationLog.findMany === 'function';
  } catch {
    return false;
  }
}

function mdOf(d) {
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function awardBirthdayPoints(tenantId, memberId, kind) {
  try {
    const loyalty = require('./loyalty');
    const pts = kind === 'anniversary' ? ANNIVERSARY_POINTS : BIRTHDAY_POINTS;
    await loyalty.awardPoints(tenantId, memberId, pts, kind, null);
    return pts;
  } catch {
    return 0; // loyalty merge na hua / setting off ho to skip
  }
}

async function processTenantCelebrations(tenantId, { dryRun = false } = {}) {
  if (!schemaReady()) return { skipped: true, reason: 'schema-not-merged' };
  const year = new Date().getFullYear();
  const todayMD = mdOf(new Date());

  const members = await prisma.member.findMany({
    where: { tenantId, status: 'active' },
    select: { id: true, name: true, email: true, dateOfBirth: true, createdAt: true },
  });

  const birthdays = members.filter((m) => m.dateOfBirth && mdOf(m.dateOfBirth) === todayMD);
  const anniversaries = members.filter((m) => {
    const years = year - new Date(m.createdAt).getFullYear();
    return years >= 1 && mdOf(m.createdAt) === todayMD;
  });

  const results = [];

  for (const m of birthdays) {
    const exists = await prisma.celebrationLog.findUnique({
      where: { memberId_kind_year: { memberId: m.id, kind: 'birthday', year } },
    });
    if (exists) continue;
    results.push({ memberId: m.id, name: m.name, kind: 'birthday' });
    if (dryRun) continue;
    try {
      if (m.email) await notify(tenantId, m.email, 'birthday', { memberName: m.name });
      const pts = await awardBirthdayPoints(tenantId, m.id, 'birthday');
      await createNotification(prisma, {
        tenantId, role: 'admin', type: 'celebration.birthday',
        message: `🎂 Aaj ${m.name} ki birthday hai!`,
      });
      await createNotification(prisma, {
        tenantId, role: 'receptionist', type: 'celebration.birthday',
        message: `🎂 Aaj ${m.name} ki birthday hai!`,
      });
      await prisma.celebrationLog.create({
        data: { tenantId, memberId: m.id, kind: 'birthday', year },
      });
      results[results.length - 1].sent = true;
      results[results.length - 1].points = pts;
    } catch (err) {
      results[results.length - 1].error = String((err && err.message) || err);
    }
  }

  for (const m of anniversaries) {
    const years = year - new Date(m.createdAt).getFullYear();
    const exists = await prisma.celebrationLog.findUnique({
      where: { memberId_kind_year: { memberId: m.id, kind: 'anniversary', year } },
    });
    if (exists) continue;
    results.push({ memberId: m.id, name: m.name, kind: 'anniversary', years });
    if (dryRun) continue;
    try {
      if (m.email) await notify(tenantId, m.email, 'anniversary', { memberName: m.name, years });
      const pts = await awardBirthdayPoints(tenantId, m.id, 'anniversary');
      await createNotification(prisma, {
        tenantId, role: 'admin', type: 'celebration.anniversary',
        message: `🎉 ${m.name} ke ${years} saal mukammal — community anniversary!`,
      });
      await prisma.celebrationLog.create({
        data: { tenantId, memberId: m.id, kind: 'anniversary', year },
      });
      results[results.length - 1].sent = true;
      results[results.length - 1].points = pts;
    } catch (err) {
      results[results.length - 1].error = String((err && err.message) || err);
    }
  }

  return { tenantId, birthdays: birthdays.length, anniversaries: anniversaries.length, results };
}

async function runCelebrations({ dryRun = false } = {}) {
  if (!schemaReady()) return { skipped: true, reason: 'schema-not-merged' };
  const tenants = await prisma.tenant.findMany({
    where: { status: 'active' },
    select: { id: true },
  });
  const out = [];
  for (const t of tenants) {
    try {
      out.push(await processTenantCelebrations(t.id, { dryRun }));
    } catch (err) {
      out.push({ tenantId: t.id, error: String((err && err.message) || err) });
    }
  }
  return { tenants: out.length, details: out };
}

function ensureCelebrationsScheduled() {
  const jobs = getJobs();
  if (!jobs) return false;
  try {
    jobs.registerHandler('celebrations', async () => runCelebrations({}));
  } catch {
    // pehle se registered
  }
  // daily enqueue — docExpiryJob wala pattern
  try {
    jobs.enqueue('celebrations', {}, { runAt: nextDailyRun() });
  } catch {}
  return true;
}

function nextDailyRun() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7, 0, 0, 0); // subah 7 baje
  return d;
}

module.exports = {
  runCelebrations,
  processTenantCelebrations,
  ensureCelebrationsScheduled,
  schemaReady,
};
