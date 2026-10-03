// Phase 50 Track 8/10: Data retention engine.
// Per-tenant RetentionPolicy ke hisab se purana data delete ya anonymize karta hai.
// - dryRun=true par sirf gin'ti hoti hai, kuch change nahi hota (preview).
// - autoDelete=true -> deleteMany; false -> anonymize (text fields placeholder).
// Har table try/catch me hai — ek fail ho to baqi chalte hain, details me report hota hai.
// Run ka record RetentionRun me + writeAudit se audit log me jata hai.
//
// Phase 32 (routes/data-export.js) se link:
// - Purge se PEHLE user chahe to member ka GDPR export (POST /api/data-export/member/:id/export)
//   download kar le — yeh lib khud export nahi banati, lekin coordinator UI me
//   retention page par "export first" ka button laga sakta hai (integration note route file me).

const prisma = require('./prisma');
const { writeAudit } = require('../middleware/audit');

const MIN_DAYS = 7;
const MAX_DAYS = 3650;
const BATCH = 1000;

// dataType -> tables. delete: rows delete hongi. anonymize: fields placeholder.
// `via` = tenant tak relation path (jis model me seedha tenantId nahi).
const TARGETS = {
  logs: [
    { model: 'accessLog', dateField: 'createdAt', mode: 'delete' },
    { model: 'loginAlert', dateField: 'createdAt', mode: 'delete' },
    { model: 'apiUsageLog', dateField: 'createdAt', mode: 'delete' },
  ],
  messages: [
    { model: 'message', dateField: 'createdAt', mode: 'anonymize', textFields: ['body'], via: 'conversation' },
    { model: 'commMessage', dateField: 'createdAt', mode: 'anonymize', textFields: ['body', 'subject'] },
    { model: 'notification', dateField: 'createdAt', mode: 'delete' },
  ],
  visitors: [
    { model: 'visitor', dateField: 'createdAt', mode: 'anonymize', textFields: ['name', 'phone', 'email', 'cnic', 'purpose'] },
    { model: 'eventCheckin', dateField: 'checkedInAt', mode: 'delete', via: 'event' },
  ],
  marketing: [
    { model: 'job', dateField: 'createdAt', mode: 'delete' },
    { model: 'newsletterSend', dateField: 'sentAt', mode: 'delete', via: 'newsletter' },
    { model: 'smsLog', dateField: 'createdAt', mode: 'delete' },
    { model: 'whatsappLog', dateField: 'createdAt', mode: 'delete' },
  ],
};

const ANON_TEXT = '[anonymized]';

function retentionEnabled() {
  return !!(prisma && prisma.retentionPolicy && prisma.retentionRun);
}

// tenant-scoped where clause — seedha tenantId ho ya via relation path
function tenantWhere(tenantId, via) {
  return via ? { [via]: { tenantId } } : { tenantId };
}

function validateDays(days) {
  const d = parseInt(days, 10);
  if (!Number.isFinite(d) || d < MIN_DAYS || d > MAX_DAYS) {
    const err = new Error(`retainDays ${MIN_DAYS}..${MAX_DAYS} ke darmiyan ho`);
    err.status = 400;
    throw err;
  }
  return d;
}

async function countOlder(tenantId, target, cutoff) {
  return prisma[target.model].count({
    where: { ...tenantWhere(tenantId, target.via), [target.dateField]: { lt: cutoff } },
  });
}

async function deleteOlder(tenantId, target, cutoff) {
  const { model, dateField, via } = target;
  let total = 0;
  for (;;) {
    const rows = await prisma[model].findMany({
      where: { ...tenantWhere(tenantId, via), [dateField]: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    if (!rows.length) break;
    await prisma[model].deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    total += rows.length;
    if (rows.length < BATCH) break;
  }
  return total;
}

async function anonymizeOlder(tenantId, target, cutoff) {
  const { model, dateField, via, textFields } = target;
  const data = {};
  for (const f of textFields) data[f] = ANON_TEXT;
  let total = 0;
  for (;;) {
    const rows = await prisma[model].findMany({
      where: { ...tenantWhere(tenantId, via), [dateField]: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    if (!rows.length) break;
    await prisma[model].updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data });
    total += rows.length;
    if (rows.length < BATCH) break;
  }
  return total;
}

// policy: { dataType, retainDays, autoDelete }. dryRun default true.
// NOTE: policy.autoDelete=false ka matlab anonymize — TARGETS me har table ka
// default mode (delete/anonymize) wahi reflect karta hai.
async function runRetention(tenantId, { dataType, retainDays, dryRun = true, runBy = null, policyId = null } = {}) {
  if (!retentionEnabled()) return { skipped: 'not_migrated' };
  const targets = TARGETS[dataType];
  if (!targets) {
    const err = new Error(`dataType in me se ho: ${Object.keys(TARGETS).join(', ')}`);
    err.status = 400;
    throw err;
  }
  const days = validateDays(retainDays);
  return runForTargets(tenantId, targets, dataType, { dryRun, runBy, policyId, retainDays: days });
}

async function runForTargets(tenantId, targets, dataType, { dryRun, runBy, policyId, retainDays, forceDelete = false }) {
  const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000);
  const mode = dryRun ? 'dry_run' : 'live';
  const perTable = [];
  let scanned = 0, deleted = 0, anonymized = 0;

  for (const t of targets) {
    if (!prisma[t.model]) {
      perTable.push({ model: t.model, status: 'skipped_no_model' });
      continue;
    }
    try {
      const n = await countOlder(tenantId, t, cutoff);
      scanned += n;
      let done = 0, action = 'none';
      if (n > 0 && !dryRun) {
        // policy.autoDelete=true ho to anonymize tables bhi delete hoti hain
        if (t.mode === 'delete' || forceDelete) {
          done = await deleteOlder(tenantId, t, cutoff);
          deleted += done;
          action = 'deleted';
        } else {
          done = await anonymizeOlder(tenantId, t, cutoff);
          anonymized += done;
          action = 'anonymized';
        }
      }
      perTable.push({ model: t.model, status: 'ok', matched: n, [action === 'none' ? 'would' : action]: n, action: dryRun ? 'dry_run' : action });
    } catch (e) {
      perTable.push({ model: t.model, status: 'error', error: e.message });
    }
  }

  const run = await prisma.retentionRun.create({
    data: {
      tenantId, policyId, dataType, mode, scanned, deleted, anonymized,
      details: { perTable, cutoff: cutoff.toISOString() },
      runBy,
    },
  });

  await writeAudit({
    tenantId, actorId: runBy, action: 'retention.run', entity: 'RetentionPolicy',
    entityId: policyId,
    newValue: { dataType, mode, scanned, deleted, anonymized },
  });

  return { runId: run.id, mode, scanned, deleted, anonymized, perTable };
}

// Tamam policies (ya ek dataType) par run. dryRun default true.
async function runAllPolicies(tenantId, { dataType = null, dryRun = true, runBy = null } = {}) {
  if (!retentionEnabled()) return { skipped: 'not_migrated' };
  const policies = await prisma.retentionPolicy.findMany({
    where: { tenantId, ...(dataType ? { dataType } : {}) },
  });
  const results = [];
  for (const p of policies) {
    const targets = TARGETS[p.dataType] || [];
    const r = await runForTargets(tenantId, targets, p.dataType, {
      dryRun, runBy, policyId: p.id, retainDays: p.retainDays, forceDelete: !!p.autoDelete,
    });
    results.push({ policyId: p.id, dataType: p.dataType, ...r });
  }
  return { results };
}

module.exports = {
  retentionEnabled, validateDays, runRetention, runAllPolicies, TARGETS,
  MIN_DAYS, MAX_DAYS,
};
