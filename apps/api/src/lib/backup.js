// Phase 32 Track 10: Database backup automation.
// pg_dump preferred (full schema+data). If pg_dump binary is missing in the
// container, falls back to a Prisma-based data-only dump (INSERT statements)
// so backups are ALWAYS real — never silently skipped.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const prisma = require('./prisma');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
const RETENTION = Math.max(1, parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10));

function backupModel() {
  return prisma.backupRecord || null;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

async function hasBinary(cmd) {
  try { await execFileAsync(cmd, ['--version']); return true; }
  catch (e) { return e && e.code !== 'ENOENT' ? true : false; }
}

function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Fallback: data-only dump via Prisma when pg_dump is unavailable.
async function prismaDataDump(outPath) {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const out = fs.createWriteStream(outPath, 'utf8');
  out.write(`-- CoworkOS data-only dump (pg_dump not available in this container)\n`);
  out.write(`-- Generated: ${new Date().toISOString()}\n`);
  out.write(`-- Restore: review + run the INSERTs manually. Schema (DDL) NOT included.\n\n`);
  for (const { tablename } of tables) {
    if (tablename === '_prisma_migrations') continue;
    const cols = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tablename}
      ORDER BY ordinal_position`;
    const names = cols.map((c) => c.column_name);
    if (!names.length) continue;
    const colList = names.map((n) => `"${n.replace(/"/g, '""')}"`).join(', ');
    out.write(`-- Table: ${tablename} (${names.length} columns)\n`);
    // Stream rows in chunks to avoid huge memory use.
    let offset = 0;
    const CHUNK = 500;
    for (;;) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "${tablename.replace(/"/g, '""')}" ORDER BY 1 LIMIT ${CHUNK} OFFSET ${offset}`
      );
      if (!rows.length) break;
      for (const row of rows) {
        const vals = names.map((n) => sqlLiteral(row[n])).join(', ');
        out.write(`INSERT INTO "${tablename.replace(/"/g, '""')}" (${colList}) VALUES (${vals});\n`);
      }
      offset += CHUNK;
    }
    out.write('\n');
  }
  await new Promise((resolve, reject) => { out.end((e) => (e ? reject(e) : resolve())); });
}

async function enforceRetention() {
  const m = backupModel();
  if (!m) return;
  const keep = await m.findMany({ orderBy: { createdAt: 'desc' }, take: RETENTION, select: { id: true } });
  const keepIds = new Set(keep.map((r) => r.id));
  const old = await m.findMany({ orderBy: { createdAt: 'desc' }, skip: RETENTION });
  for (const rec of old) {
    try { if (rec.filePath && fs.existsSync(rec.filePath)) fs.unlinkSync(rec.filePath); } catch { /* ignore */ }
    try { await m.delete({ where: { id: rec.id } }); } catch { /* ignore */ }
  }
  return keepIds;
}

async function runBackup({ note = null } = {}) {
  const m = backupModel();
  if (!m) throw new Error('BackupRecord model not available yet (schema merge pending).');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set — cannot back up.');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const fileName = `backup-${stamp()}.sql.gz`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const tmpSql = path.join(BACKUP_DIR, `backup-${stamp()}.tmp.sql`);

  let method = 'pg_dump';
  try {
    if (!(await hasBinary('pg_dump'))) {
      method = 'prisma-fallback';
      await prismaDataDump(tmpSql);
    } else {
      await execFileAsync('pg_dump', [dbUrl, '--no-owner', '--no-acl', '-f', tmpSql]);
    }
    // gzip the dump
    await pipeline(fs.createReadStream(tmpSql), zlib.createGzip({ level: 6 }), fs.createWriteStream(filePath));
  } finally {
    try { if (fs.existsSync(tmpSql)) fs.unlinkSync(tmpSql); } catch { /* ignore */ }
  }

  const sizeBytes = BigInt(fs.statSync(filePath).size);
  const record = await m.create({
    data: {
      fileName,
      filePath,
      sizeBytes,
      status: 'completed',
      note: note || (method === 'prisma-fallback'
        ? 'Data-only dump (pg_dump binary not found in container).'
        : null),
    },
  });
  await enforceRetention();
  return { ...record, sizeBytes: Number(sizeBytes), method };
}

async function listBackups() {
  const m = backupModel();
  if (!m) throw new Error('BackupRecord model not available yet (schema merge pending).');
  const rows = await m.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map((r) => ({ ...r, sizeBytes: Number(r.sizeBytes), exists: r.filePath ? fs.existsSync(r.filePath) : false }));
}

async function deleteBackup(id) {
  const m = backupModel();
  if (!m) throw new Error('BackupRecord model not available yet (schema merge pending).');
  const rec = await m.findUnique({ where: { id } });
  if (!rec) return null;
  try { if (rec.filePath && fs.existsSync(rec.filePath)) fs.unlinkSync(rec.filePath); } catch { /* ignore */ }
  await m.delete({ where: { id } });
  return true;
}

// Restore safety: dry-run validates the file; real restore needs confirm:true
// and takes a safety backup first.
async function restoreBackup(id, { confirmed = false } = {}) {
  const m = backupModel();
  if (!m) throw new Error('BackupRecord model not available yet (schema merge pending).');
  const rec = await m.findUnique({ where: { id } });
  if (!rec) throw new Error('Backup not found.');
  if (!rec.filePath || !fs.existsSync(rec.filePath)) throw new Error('Backup file is missing from disk.');

  // Dry-run checks: gunzip head + SQL markers.
  const checks = { fileExists: true, gzipOk: false, looksLikeSql: false };
  let head = '';
  try {
    const gz = fs.readFileSync(rec.filePath);
    head = zlib.gunzipSync(gz.slice(0, Math.min(gz.length, 65536))).toString('utf8').slice(0, 4000);
    checks.gzipOk = true;
    checks.looksLikeSql = /PostgreSQL database dump|CoworkOS data-only dump|CREATE TABLE|INSERT INTO/i.test(head);
  } catch (e) {
    checks.error = String(e.message).slice(0, 200);
  }
  if (!confirmed) return { dryRun: true, backup: rec.fileName, checks };

  if (!checks.gzipOk || !checks.looksLikeSql) {
    throw new Error('Dry-run failed: backup file does not look like a valid SQL dump. Restore aborted.');
  }
  if (!(await hasBinary('psql'))) {
    throw new Error('psql binary not available in this container — restore cannot run safely. Aborted.');
  }

  // Safety backup BEFORE touching anything.
  const safety = await runBackup({ note: `Pre-restore safety backup (before restoring ${rec.fileName}).` });

  const dbUrl = process.env.DATABASE_URL;
  const tmpSql = path.join(BACKUP_DIR, `restore-${stamp()}.tmp.sql`);
  try {
    await pipeline(fs.createReadStream(rec.filePath), zlib.createGunzip(), fs.createWriteStream(tmpSql));
    await execFileAsync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', tmpSql]);
  } finally {
    try { if (fs.existsSync(tmpSql)) fs.unlinkSync(tmpSql); } catch { /* ignore */ }
  }
  return { restored: true, backup: rec.fileName, safetyBackup: safety.fileName };
}

// Nightly job: run backup, then re-enqueue itself for +24h.
function registerBackupJob() {
  try {
    const { registerHandler, enqueue } = require('./jobs');
    registerHandler('db-backup', async () => {
      await runBackup({ note: 'Scheduled nightly backup.' });
      await enqueue('db-backup', {}, { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    });
  } catch { /* jobs module unavailable — route still works manually */ }
}

async function ensureBackupScheduled() {
  try {
    const { enqueue } = require('./jobs');
    const m = backupModel();
    const pending = m ? await prisma.job.count({ where: { type: 'db-backup', status: 'pending' } }).catch(() => 0) : 0;
    if (!pending) {
      const tonight = new Date();
      tonight.setHours(2, 30, 0, 0);
      if (tonight <= new Date()) tonight.setDate(tonight.getDate() + 1);
      await enqueue('db-backup', {}, { runAt: tonight });
      return true;
    }
    return false;
  } catch { return false; }
}

module.exports = {
  runBackup, listBackups, deleteBackup, restoreBackup,
  registerBackupJob, ensureBackupScheduled, BACKUP_DIR, RETENTION,
};
