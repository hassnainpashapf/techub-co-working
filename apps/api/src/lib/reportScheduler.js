// Phase 52 Track 4: Scheduled delivery for custom reports.
// - ensureReportScheduler(): daily wiring (server.js se call karega) — due
//   schedules ko 'custom-report-send' job queue me dalta hai (phase-38 pattern).
// - runDueSchedules(): immediate scan (cron se pehle ya manually bhi).
// - sendScheduleNow(schedule): report chalao -> csv/pdf banao -> recipients ko email.
const PDFDocument = require('pdfkit');

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');
const { writeAudit } = require('../middleware/audit');

function modelsReady() {
  return !!prisma.reportSchedule;
}

// Track 1 ka engine lazily require karte hain (parallel track, merge order safe).
function getEngine() {
  try {
    const engine = require('./reportEngine');
    if (engine && typeof engine.runReport === 'function') return engine;
  } catch (_) {}
  return null;
}

// ---------------------------------------------------------------- helpers ---
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function buildCsv(reportName, columns, rows) {
  const header = columns.map((c) => csvCell(c.label || c.field)).join(',');
  const lines = rows.map((r) => columns.map((c) => csvCell(r[c.field])).join(','));
  return '\uFEFF' + header + '\n' + lines.join('\n');
}

function buildPdf(reportName, columns, rows) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: columns.length > 5 ? 'landscape' : 'portrait' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(reportName || 'Custom Report', { underline: true });
    doc.fontSize(9).fillColor('#666').text(`Generated: ${new Date().toLocaleString('en-PK')} • Rows: ${rows.length}`);
    doc.moveDown(0.6);
    const startX = 36;
    const colW = Math.min(160, Math.max(70, (doc.page.width - 72) / Math.max(columns.length, 1)));
    let y = doc.y;
    const drawRow = (cells, bold) => {
      if (y > doc.page.height - 60) { doc.addPage(); y = 36; }
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#111');
      cells.forEach((txt, i) => {
        doc.text(String(txt ?? '').slice(0, 60), startX + i * colW, y, { width: colW - 4 });
      });
      y += 14;
    };
    drawRow(columns.map((c) => c.label || c.field), true);
    y += 2;
    rows.slice(0, 5000).forEach((r) => drawRow(columns.map((c) => r[c.field])));
    doc.end();
  });
}

function columnsFrom(report, rows) {
  const cols = Array.isArray(report.columns) ? report.columns : [];
  if (cols.length) return cols.filter((c) => c && c.field).map((c) => ({ field: c.field, label: c.label || c.field }));
  const keys = Object.keys(rows[0] || {});
  return keys.map((k) => ({ field: k, label: k }));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanRecipients(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  return arr.map((e) => String(e || '').trim().toLowerCase()).filter((e) => {
    if (!EMAIL_RE.test(e) || seen.has(e)) return false;
    seen.add(e);
    return true;
  }).slice(0, 50);
}

// ------------------------------------------------------------------- due ----
function isDue(schedule, now) {
  if (!schedule || !schedule.isActive) return false;
  const last = schedule.lastSentAt ? new Date(schedule.lastSentAt) : null;
  if (last && last.toDateString() === now.toDateString()) return false; // aaj bheji ja chuki
  if (schedule.frequency === 'daily') return true;
  if (schedule.frequency === 'monthly') return now.getDate() === (schedule.dayOfMonth ?? 1);
  return now.getDay() === (schedule.dayOfWeek ?? 1); // weekly
}

// ------------------------------------------------------------------- send ---
async function sendScheduleNow(scheduleOrId, actorId = null) {
  if (!modelsReady()) return { skipped: 'not_migrated' };
  const schedule = typeof scheduleOrId === 'object'
    ? scheduleOrId
    : await prisma.reportSchedule.findUnique({
        where: { id: scheduleOrId },
        include: { report: true },
      });
  if (!schedule) return { error: 'not_found' };
  const report = schedule.report;
  if (!report) return { error: 'report_missing' };

  const engine = getEngine();
  if (!engine) return { error: 'report_engine_not_ready' };

  let rows;
  try {
    rows = await engine.runReport(schedule.tenantId, report);
  } catch (e) {
    return { error: 'report_failed', detail: e.message };
  }
  rows = Array.isArray(rows) ? rows : [];
  const columns = columnsFrom(report, rows);

  const recipients = cleanRecipients(schedule.recipients);
  if (!recipients.length) return { error: 'no_recipients' };

  const format = schedule.format === 'csv' ? 'csv' : 'pdf';
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = String(report.name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  let attachment;
  try {
    if (format === 'csv') {
      attachment = {
        filename: `report-${slug}-${stamp}.csv`,
        content: Buffer.from(buildCsv(report.name, columns, rows), 'utf8'),
      };
    } else {
      attachment = {
        filename: `report-${slug}-${stamp}.pdf`,
        content: await buildPdf(report.name, columns, rows),
      };
    }
  } catch (e) {
    return { error: 'build_failed', detail: e.message };
  }

  const result = await sendEmail(schedule.tenantId, {
    to: recipients,
    subject: `${report.name} — scheduled report (${stamp})`,
    html: `<p>Salam,</p><p><strong>${report.name}</strong> ki scheduled report (${format.toUpperCase()}, ${rows.length} rows) attached hai.</p>`,
    attachments: [attachment],
  });

  const sentOk = result && (result.sent || result.queued || result.sent === undefined);
  if (sentOk) {
    await prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: { lastSentAt: new Date() },
    }).catch(() => {});
    await writeAudit({
      tenantId: schedule.tenantId,
      actorId,
      action: 'report_schedule.send',
      entity: 'report_schedule',
      entityId: schedule.id,
      newValue: { reportId: schedule.reportId, format, rows: rows.length, recipients: recipients.length },
    }).catch(() => {});
  }
  return { ok: sentOk, recipients: recipients.length, rows: rows.length, format };
}

// ---------------------------------------------------------------- scheduler -
async function runDueSchedules() {
  if (!modelsReady()) return { skipped: 'not_migrated' };
  const { enqueue } = require('./jobs');
  const now = new Date();
  const schedules = await prisma.reportSchedule.findMany({ where: { isActive: true } });
  let queued = 0;
  for (const s of schedules) {
    if (!isDue(s, now)) continue;
    try {
      const pending = await prisma.job
        .count({ where: { type: 'custom-report-send', status: 'pending', data: { contains: s.id } } })
        .catch(() => 0);
      if (pending > 0) continue;
      await enqueue('custom-report-send', { scheduleId: s.id }, { tenantId: s.tenantId });
      queued += 1;
    } catch (_) {}
  }
  return { ok: true, queued };
}

async function processSendJob(job) {
  const scheduleId = job?.data?.scheduleId;
  if (!scheduleId) return;
  try {
    await sendScheduleNow(scheduleId, null);
  } catch (e) {
    console.error('[phase52] custom-report-send failed:', e.message);
  }
}

async function ensureReportScheduler() {
  try {
    await runDueSchedules();
    // subah ke run ke baad dobara ensure — job queue bharne se rokta hai
  } catch (e) {
    console.error('[phase52] report scheduler failed:', e.message);
  }
}

// Auto-register handler on require (coordinator server.js me daily wiring karega).
try {
  const { registerHandler } = require('./jobs');
  registerHandler('custom-report-send', processSendJob);
} catch (e) {
  console.error('[phase52] report scheduler handler registration failed:', e.message);
}

module.exports = {
  runDueSchedules,
  ensureReportScheduler,
  sendScheduleNow,
  isDue,
};
