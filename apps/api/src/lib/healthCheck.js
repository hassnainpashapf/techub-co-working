// Phase 32 Track 9: System health checks + alerting (no Redis, no new deps).
// Checks: DB latency, job queue depth/failures, cache stats, process vitals.
// Alerts: email to tenant ceo/admin when thresholds breached (30-min cooldown).
// Runs as a 'health-check' job — enqueue every 5 min via startHealthScheduler().
const prisma = require('./prisma');
const { cache } = require('./cache');

const DB_LATENCY_THRESHOLD_MS = 2000;
const FAILED_JOBS_THRESHOLD = 10;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

let appVersion = '0.1.0';
try {
  appVersion = require('../../package.json').version || appVersion;
} catch { /* default */ }

// `${tenantId}:${issueKey}` -> timestamp of last alert (in-memory, per process).
const lastAlertAt = new Map();

function getJobs() {
  try {
    return require('./jobs');
  } catch {
    return null;
  }
}

async function checkDb() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: String((e && e.message) || e).slice(0, 300) };
  }
}

async function queueStats(tenantId) {
  const jobs = getJobs();
  if (!jobs) return null;
  const m = jobs.jobModel();
  if (!m) return null;
  const where = tenantId ? { tenantId } : {};
  try {
    const counts = await m.groupBy({ by: ['status'], where, _count: true });
    const out = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const c of counts) out[c.status] = (out[c.status] || 0) + (c._count || 0);
    return out;
  } catch {
    return null; // table may not exist yet
  }
}

function vitals() {
  const mem = process.memoryUsage();
  const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
  return {
    uptimeSec: Math.floor(process.uptime()),
    memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), heapTotalMb: mb(mem.heapTotal) },
    version: appVersion,
  };
}

async function statusSnapshot(tenantId) {
  const db = await checkDb();
  const queue = await queueStats(tenantId);
  return {
    db,
    queue,
    cache: cache.stats(),
    ...vitals(),
    at: new Date().toISOString(),
  };
}

async function alertAdmins(tenantId, issues) {
  const key = issues.map((i) => i.key).sort().join('|');
  const ck = `${tenantId || 'global'}:${key}`;
  if (Date.now() - (lastAlertAt.get(ck) || 0) < ALERT_COOLDOWN_MS) return { skipped: true };
  lastAlertAt.set(ck, Date.now());

  const mailer = require('./mailer');
  let admins = [];
  try {
    admins = await prisma.user.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        role: { in: ['ceo', 'admin', 'super_admin'] },
        email: { not: null },
      },
      select: { email: true, name: true, tenantId: true },
    });
  } catch {
    return { sent: 0, error: 'user-query-failed' };
  }

  let sent = 0;
  for (const a of admins) {
    if (!a.email) continue;
    try {
      const r = await mailer.notify(a.tenantId || tenantId, a.email, 'systemHealthAlert', {
        name: a.name || 'Admin',
        issues: issues.map((i) => `${i.label}${i.detail ? ` — ${i.detail}` : ''}`).join('\n'),
      });
      if (r && (r.sent || r.queued)) sent += 1;
    } catch { /* one bad recipient must not break the rest */ }
  }
  return { sent };
}

async function processHealthCheck(payload = {}) {
  const issues = [];
  const db = await checkDb();
  if (!db.ok) {
    issues.push({ key: 'db-down', label: 'Database unreachable', detail: db.error });
  } else if (db.latencyMs > DB_LATENCY_THRESHOLD_MS) {
    issues.push({ key: 'db-slow', label: 'Database slow', detail: `${db.latencyMs}ms (threshold ${DB_LATENCY_THRESHOLD_MS}ms)` });
  }

  let tenants = [];
  if (payload.tenantId) {
    tenants = [{ id: payload.tenantId }];
  } else {
    try {
      tenants = await prisma.tenant.findMany({ select: { id: true } });
    } catch {
      tenants = [];
    }
  }

  const results = [];
  for (const t of tenants) {
    const q = await queueStats(t.id);
    const tIssues = [...issues];
    if (q && q.failed > FAILED_JOBS_THRESHOLD) {
      tIssues.push({ key: 'jobs-failed', label: 'Too many failed jobs', detail: `${q.failed} failed (threshold ${FAILED_JOBS_THRESHOLD})` });
    }
    let alerted = null;
    if (tIssues.length > 0) alerted = await alertAdmins(t.id, tIssues);
    results.push({ tenantId: t.id, queue: q, issues: tIssues, alerted });
  }
  return { checked: results.length, results };
}

// Auto-register the handler (idempotent) when required from server.js.
(function registerHealthCheckHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__healthCheckRegistered) return;
  jobs.__healthCheckRegistered = true;
  jobs.registerHandler('health-check', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || {};
    return processHealthCheck(p);
  });
})();

// Enqueue a health-check job every `intervalMs` (default 5 min).
// Call once from server.js: require('./lib/healthCheck').startHealthScheduler()
let schedulerTimer = null;
function startHealthScheduler(intervalMs = 5 * 60 * 1000) {
  if (schedulerTimer) return;
  const jobs = getJobs();
  if (!jobs) return;
  schedulerTimer = setInterval(() => {
    jobs.enqueue('health-check', {}, { maxAttempts: 1 }).catch(() => {});
  }, intervalMs);
  if (schedulerTimer.unref) schedulerTimer.unref();
}

module.exports = {
  statusSnapshot,
  processHealthCheck,
  startHealthScheduler,
  checkDb,
  queueStats,
  DB_LATENCY_THRESHOLD_MS,
  FAILED_JOBS_THRESHOLD,
};
