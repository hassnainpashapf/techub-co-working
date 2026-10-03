// Phase 38 Track 1: Scheduled Report Emails — generation + background send.
// Registers 'scheduled-report-send' handler (auto-register on require) and
// exposes ensureScheduledReportsScheduled() for server.js daily wiring.
const PDFDocument = require('pdfkit');

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

function modelsReady() {
  return !!prisma.scheduledReport;
}

const num = (v) => Number(v) || 0;
const money = (v) => `Rs ${num(v).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
const monthKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};

function periodFor(frequency) {
  const to = new Date();
  const from = new Date(to);
  if (frequency === 'monthly') from.setDate(from.getDate() - 30);
  else from.setDate(from.getDate() - 7);
  return { from, to };
}

// ---------------------------------------------------------------- data ----
async function occupancyData(tenantId) {
  const buildings = await prisma.building.findMany({
    where: { tenantId },
    include: { floors: { include: { zones: { include: { units: true } } } } },
  });
  const rows = [];
  let totalUnits = 0;
  let occupied = 0;
  for (const b of buildings) {
    const units = b.floors.flatMap((f) => f.zones.flatMap((z) => z.units));
    const occ = units.filter((u) => u.status === 'occupied').length;
    totalUnits += units.length;
    occupied += occ;
    rows.push({
      Building: b.name,
      Units: units.length,
      Occupied: occ,
      'Occupancy %': units.length ? Math.round((occ / units.length) * 100) : 0,
    });
  }
  const [activeMembers, todayBookings] = await Promise.all([
    prisma.member.count({ where: { tenantId, status: 'active' } }),
    prisma.booking.count({
      where: {
        tenantId,
        startAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt: new Date(new Date().setHours(24, 0, 0, 0)),
        },
      },
    }).catch(() => 0),
  ]);
  return {
    title: 'Occupancy Report',
    summary: [
      ['Total units', totalUnits],
      ['Occupied', occupied],
      ['Occupancy rate', totalUnits ? `${Math.round((occupied / totalUnits) * 100)}%` : '—'],
      ['Active members', activeMembers],
      ["Today's bookings", todayBookings],
    ],
    headers: ['Building', 'Units', 'Occupied', 'Occupancy %'],
    rows,
  };
}

async function revenueData(tenantId, from, to) {
  const payments = await prisma.payment.findMany({
    where: { tenantId, paidAt: { gte: from, lte: to } },
    select: { amount: true, paidAt: true },
  });
  const byMonth = {};
  for (const p of payments) {
    const k = monthKey(p.paidAt);
    byMonth[k] = (byMonth[k] || 0) + num(p.amount);
  }
  const rows = Object.keys(byMonth)
    .sort()
    .map((m) => ({ Month: m, 'Revenue collected': money(byMonth[m]) }));
  const total = payments.reduce((s, p) => s + num(p.amount), 0);
  const ar = await prisma.invoice.aggregate({
    where: { tenantId, status: { in: ['unpaid', 'partial', 'overdue'] } },
    _sum: { amount: true },
  });
  const paidSum = await prisma.invoice.aggregate({
    where: { tenantId, status: { in: ['unpaid', 'partial', 'overdue'] } },
    _sum: { amountPaid: true },
  });
  const outstanding = num(ar._sum.amount) - num(paidSum._sum.amountPaid);
  return {
    title: 'Revenue Report',
    summary: [
      ['Period revenue collected', money(total)],
      ['Payments received', payments.length],
      ['Accounts receivable (open)', money(outstanding)],
    ],
    headers: ['Month', 'Revenue collected'],
    rows,
  };
}

async function expensesData(tenantId, from, to) {
  const expenses = await prisma.expense.findMany({
    where: { tenantId, date: { gte: from, lte: to }, status: 'approved' },
    select: { category: true, amount: true, date: true },
  });
  const byCat = {};
  for (const e of expenses) {
    byCat[e.category] = (byCat[e.category] || 0) + num(e.amount);
  }
  const rows = Object.keys(byCat)
    .sort()
    .map((c) => ({ Category: c, 'Total spent': money(byCat[c]), Transactions: expenses.filter((e) => e.category === c).length }));
  const total = expenses.reduce((s, e) => s + num(e.amount), 0);
  return {
    title: 'Expense Report',
    summary: [
      ['Total approved expenses', money(total)],
      ['Transactions', expenses.length],
    ],
    headers: ['Category', 'Total spent', 'Transactions'],
    rows,
  };
}

async function churnData(tenantId) {
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const [exited, active] = await Promise.all([
    prisma.member.findMany({
      where: { tenantId, status: 'exited', updatedAt: { gte: since } },
      select: { name: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
    prisma.member.count({ where: { tenantId, status: 'active' } }),
  ]);
  const rate = active + exited.length ? Math.round((exited.length / (active + exited.length)) * 100) : 0;
  const atRisk = await prisma.invoice.count({
    where: { tenantId, status: 'overdue' },
  });
  return {
    title: 'Churn Report (90 days)',
    summary: [
      ['Members exited (90d)', exited.length],
      ['Active members', active],
      ['Churn rate', `${rate}%`],
      ['Overdue invoices (at-risk signal)', atRisk],
    ],
    headers: ['Member', 'Exited on'],
    rows: exited.map((m) => ({
      Member: m.name,
      'Exited on': m.updatedAt ? new Date(m.updatedAt).toLocaleDateString('en-PK') : '—',
    })),
  };
}

async function pnlData(tenantId, from, to) {
  const [payments, expenses, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: { tenantId, paidAt: { gte: from, lte: to } },
      include: { invoice: { select: { invoiceType: true } } },
    }),
    prisma.expense.findMany({
      where: { tenantId, date: { gte: from, lte: to }, status: 'approved' },
      select: { amount: true },
    }),
    prisma.refund.findMany({
      where: { tenantId, status: { in: ['approved', 'processed'] }, createdAt: { gte: from, lte: to } },
      select: { amount: true },
    }),
  ]);
  const revenue = payments
    .filter((p) => p.invoice?.invoiceType !== 'proforma')
    .reduce((s, p) => s + num(p.amount), 0);
  const expTotal = expenses.reduce((s, e) => s + num(e.amount), 0);
  const refTotal = refunds.reduce((s, r) => s + num(r.amount), 0);
  const net = revenue - expTotal - refTotal;
  const byMonth = {};
  for (const p of payments) {
    if (p.invoice?.invoiceType === 'proforma') continue;
    const k = monthKey(p.paidAt);
    byMonth[k] = byMonth[k] || { rev: 0, exp: 0 };
    byMonth[k].rev += num(p.amount);
  }
  return {
    title: 'Profit & Loss',
    summary: [
      ['Revenue (cash)', money(revenue)],
      ['Expenses (approved)', money(expTotal)],
      ['Refunds', money(refTotal)],
      ['Net', money(net)],
    ],
    headers: ['Month', 'Revenue', 'Net (approx)'],
    rows: Object.keys(byMonth)
      .sort()
      .map((m) => ({ Month: m, Revenue: money(byMonth[m].rev), 'Net (approx)': money(byMonth[m].rev) })),
  };
}

const GENERATORS = {
  occupancy: occupancyData,
  revenue: revenueData,
  expenses: expensesData,
  churn: churnData,
  pnl: pnlData,
};

// ---------------------------------------------------------------- files ---
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(report) {
  const lines = [];
  lines.push(report.title);
  for (const [k, v] of report.summary) lines.push(`${csvEscape(k)},${csvEscape(v)}`);
  lines.push('');
  lines.push(report.headers.map(csvEscape).join(','));
  for (const r of report.rows) {
    lines.push(report.headers.map((h) => csvEscape(r[h])).join(','));
  }
  return '\ufeff' + lines.join('\n');
}

function buildPdf(report, periodLabel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1e1b4b').text(report.title);
    doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(periodLabel);
    doc.moveDown();

    for (const [k, v] of report.summary) {
      doc.fontSize(11).fillColor('#64748b').text(k + ': ', { continued: true });
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text(String(v));
    }
    doc.moveDown();

    const rows = report.rows.slice(0, 60);
    if (rows.length) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e1b4b').text('Details');
      doc.moveDown(0.5);
      const colW = 460 / report.headers.length;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');
      const y0 = doc.y;
      doc.rect(50, y0, 460, 18).fill('#312e81');
      report.headers.forEach((h, i) => doc.fillColor('#ffffff').text(h, 55 + i * colW, y0 + 4, { width: colW - 10 }));
      doc.y = y0 + 22;
      doc.font('Helvetica').fontSize(9);
      rows.forEach((r, ri) => {
        if (ri % 2 === 0) doc.rect(50, doc.y - 2, 460, 15).fill('#f1f5f9');
        report.headers.forEach((h, i) =>
          doc.fillColor('#0f172a').text(String(r[h] ?? ''), 55 + i * colW, doc.y, { width: colW - 10 })
        );
        doc.moveDown(0.7);
      });
      if (report.rows.length > 60) {
        doc.fontSize(9).fillColor('#64748b').text(`…and ${report.rows.length - 60} more rows (see CSV).`);
      }
    }
    doc.end();
  });
}

// ---------------------------------------------------------------- send ----
async function sendReportNow(report) {
  const { from, to } = periodFor(report.frequency);
  const gen = GENERATORS[report.reportType];
  if (!gen) throw new Error(`unknown report type ${report.reportType}`);
  const data = await gen(report.tenantId, from, to);
  const periodLabel = `Period: ${from.toLocaleDateString('en-PK')} – ${to.toLocaleDateString('en-PK')}`;
  const stamp = to.toISOString().slice(0, 10);
  const baseName = `${report.reportType}-report-${stamp}`;

  let attachment;
  if (report.format === 'csv') {
    attachment = {
      filename: `${baseName}.csv`,
      content: Buffer.from(buildCsv(data), 'utf8'),
      contentType: 'text/csv',
    };
  } else {
    attachment = {
      filename: `${baseName}.pdf`,
      content: await buildPdf(data, periodLabel),
      contentType: 'application/pdf',
    };
  }

  const summaryHtml = data.summary
    .map(([k, v]) => `<tr><td style="color:#94a3b8;padding:4px 12px 4px 0">${k}</td><td style="color:#fff;font-weight:bold">${v}</td></tr>`)
    .join('');
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0f0f1a;color:#e5e7eb;border-radius:12px;overflow:hidden">` +
    `<div style="padding:20px 24px;background:linear-gradient(135deg,#7c3aed,#2563eb)"><h2 style="margin:0;color:#fff;font-size:18px">${data.title}</h2>` +
    `<p style="margin:4px 0 0;color:#e0e7ff;font-size:12px">${periodLabel}</p></div>` +
    `<div style="padding:24px"><table>${summaryHtml}</table>` +
    `<p style="color:#94a3b8;font-size:13px;margin-top:16px">Full details are in the attached ${report.format.toUpperCase()} file.</p></div></div>`;

  const recipients = Array.isArray(report.recipients) ? report.recipients : [];
  let sent = 0;
  for (const to of recipients) {
    const r = await sendEmail(report.tenantId, {
      to,
      subject: `${data.title} — ${stamp}`,
      html,
      attachments: [attachment],
    });
    if (r && (r.queued || r.sent)) sent += 1;
  }
  await prisma.scheduledReport.update({
    where: { id: report.id },
    data: { lastSentAt: new Date() },
  });
  return { sent, recipients: recipients.length };
}

async function processReportSend(job) {
  if (!modelsReady()) return; // migration pending — skip quietly
  const payload = job.payload || job.data || {};
  const { reportId } = payload;
  if (!reportId) return;
  const report = await prisma.scheduledReport.findUnique({ where: { id: reportId } });
  if (!report || !report.isActive) return;
  await sendReportNow(report);
}

// Due today? Weekly: dayOfWeek match (default 1=Mon). Monthly: dayOfMonth match (default 1).
function isDue(report, now) {
  if (!report.isActive) return false;
  const last = report.lastSentAt ? new Date(report.lastSentAt) : null;
  if (last && last.toDateString() === now.toDateString()) return false; // already sent today
  if (report.frequency === 'monthly') {
    return now.getDate() === (report.dayOfMonth ?? 1);
  }
  return now.getDay() === (report.dayOfWeek ?? 1);
}

async function ensureScheduledReportsScheduled() {
  try {
    if (!modelsReady()) return;
    const { enqueue } = require('./jobs');
    const now = new Date();
    const reports = await prisma.scheduledReport.findMany({ where: { isActive: true } });
    for (const r of reports) {
      if (!isDue(r, now)) continue;
      const pending = await prisma.job
        .count({ where: { type: 'scheduled-report-send', status: 'pending' } })
        .catch(() => 1);
      if (pending > 0) continue;
      await enqueue('scheduled-report-send', { reportId: r.id }, { tenantId: r.tenantId }).catch(() => {});
    }
  } catch (e) {
    console.error('[phase38] scheduled-reports schedule failed:', e.message);
  }
}

// Auto-register handler on require (coordinator wires the daily schedule in server.js).
try {
  const { registerHandler } = require('./jobs');
  registerHandler('scheduled-report-send', processReportSend);
} catch (e) {
  console.error('[phase38] scheduled-report handler registration failed:', e.message);
}

module.exports = {
  sendReportNow,
  ensureScheduledReportsScheduled,
  isDue,
  generateReport: async (tenantId, reportType) => {
    const { from, to } = periodFor(reportType === 'churn' ? 'monthly' : 'weekly');
    return GENERATORS[reportType](tenantId, from, to);
  },
};
