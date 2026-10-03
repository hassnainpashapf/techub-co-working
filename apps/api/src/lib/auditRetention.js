// Phase 32 Track 8: Audit log retention.
// Archives audit_logs older than the tenant's retention window (Setting
// "auditRetentionDays", default 365) into a JSONL file via the storage
// abstraction, verifies the archive, then deletes the archived rows.
// Delete happens ONLY after the archive file is verified (line count match).

const prisma = require('./prisma');
const storage = require('./storage');
const { writeAudit } = require('../middleware/audit');

const SETTING_KEY = 'auditRetentionDays';
const DEFAULT_DAYS = 365;
const MIN_DAYS = 30;
const MAX_DAYS = 3650;
const BATCH = 1000;

async function getRetentionDays(tenantId) {
  try {
    const row = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    });
    const days = parseInt(row && row.value, 10);
    if (Number.isFinite(days) && days >= MIN_DAYS && days <= MAX_DAYS) return days;
  } catch { /* fall through to default */ }
  return DEFAULT_DAYS;
}

async function setRetentionDays(tenantId, days) {
  const d = parseInt(days, 10);
  if (!Number.isFinite(d) || d < MIN_DAYS || d > MAX_DAYS) {
    const err = new Error(`retentionDays must be between ${MIN_DAYS} and ${MAX_DAYS}`);
    err.status = 400;
    throw err;
  }
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: SETTING_KEY } },
    update: { value: String(d) },
    create: { tenantId, key: SETTING_KEY, value: String(d) },
  });
  return d;
}

function serializeLog(log) {
  return JSON.stringify({
    id: log.id,
    tenantId: log.tenantId,
    actorId: log.actorId,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    oldValue: log.oldValue,
    newValue: log.newValue,
    ip: log.ip,
    userAgent: log.userAgent,
    createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : null,
  });
}

async function readAllLines(filePath) {
  const stream = await storage.getFileStream(filePath);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').split('\n').filter((l) => l.trim().length > 0);
}

async function runRetention(tenantId) {
  if (!tenantId) throw Object.assign(new Error('tenantId required'), { status: 400 });

  const days = await getRetentionDays(tenantId);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const total = await prisma.auditLog.count({
    where: { tenantId, createdAt: { lt: cutoff } },
  });
  if (total === 0) {
    return { tenantId, archived: 0, deleted: 0, retentionDays: days, cutoff };
  }

  // Fetch oldest-first in batches and stream into JSONL lines.
  let earliest = null;
  let latest = null;
  const lines = [];
  let cursor = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.auditLog.findMany({
      where: { tenantId, createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const log of batch) {
      lines.push(serializeLog(log));
      if (!earliest) earliest = log.createdAt;
      latest = log.createdAt;
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH) break;
  }

  if (lines.length !== total) {
    throw new Error(`fetch mismatch: expected ${total} rows, got ${lines.length} — aborting, nothing deleted`);
  }

  // Write archive via storage abstraction (S3 or local).
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `audit-${tenantId}-${stamp}.jsonl`;
  const saved = await storage.saveFile(Buffer.from(lines.join('\n'), 'utf8'), {
    folder: 'audit-archives',
    filename,
    mimetype: 'text/plain',
  });

  // VERIFY before deleting: read the file back, line count must match.
  const verifyLines = await readAllLines(saved.path);
  if (verifyLines.length !== total) {
    throw new Error(
      `archive verification failed: file has ${verifyLines.length} lines, expected ${total} — nothing deleted`
    );
  }

  // Record the archive, then delete in batches.
  await prisma.auditArchive.create({
    data: {
      tenantId,
      periodFrom: earliest,
      periodTo: latest,
      recordCount: total,
      filePath: saved.path,
    },
  });

  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ids = await prisma.auditLog.findMany({
      where: { tenantId, createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    if (ids.length === 0) break;
    const res = await prisma.auditLog.deleteMany({
      where: { id: { in: ids.map((r) => r.id) } },
    });
    deleted += res.count;
    if (ids.length < BATCH) break;
  }

  writeAudit({
    tenantId,
    action: 'audit.retention.run',
    entity: 'AuditArchive',
    newValue: { archived: total, deleted, filePath: saved.path, retentionDays: days },
  }).catch(() => {});

  return { tenantId, archived: total, deleted, filePath: saved.path, retentionDays: days, cutoff };
}

async function processAllTenants() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const out = [];
  for (const t of tenants) {
    try {
      out.push({ tenantId: t.id, ...(await runRetention(t.id)) });
    } catch (err) {
      out.push({ tenantId: t.id, error: String((err && err.message) || err) });
    }
  }
  return out;
}

// Auto-register with the job queue when available.
(function register() {
  try {
    const jobs = require('./jobs');
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('audit-retention', async (jobOrPayload) => {
        const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
        if (p.tenantId) return runRetention(p.tenantId);
        return processAllTenants();
      });
    }
  } catch { /* jobs module not present */ }
})();

module.exports = { runRetention, processAllTenants, getRetentionDays, setRetentionDays };
