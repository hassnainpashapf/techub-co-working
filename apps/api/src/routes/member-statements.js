// Phase 46 Track 8: Member Statements (multi-currency).
// Coordinator: mount with app.use('/api/member-statements', require('./routes/member-statements'));
// Sidebar link: none — members section / portal "My Statement" extend karta hai.
// Portal integration: apps/web/app/(app)/portal/invoices/page.js me "My Statement" link
//   → /portal/statement jo GET /api/member-statements/me kare (niche endpoint hai).
// Note: Track 3/4 ke currency/fxRate/baseAmount columns merge na hue hon to route
//   gracefully base currency me kaam karta hai (koi 500 nahi).
const express = require('express');
const PDFDocument = require('pdfkit');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const STAFF_ROLES = new Set(['ceo', 'admin', 'super_admin', 'manager', 'finance_officer', 'receptionist']);

// --- base currency (CurrencySetting merge na ho to PKR) ---
async function getBaseCurrency(tf) {
  try {
    const s = await prisma.currencySetting.findFirst({ where: tf, select: { baseCurrency: true } });
    return (s && s.baseCurrency) || 'PKR';
  } catch {
    return 'PKR';
  }
}

// --- defensive currency select: columns merge na hue hon to fallback ---
async function queryInvoices(tf, memberId) {
  const base = {
    where: { ...tf, memberId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, number: true, amount: true, amountPaid: true, status: true,
      createdAt: true, dueDate: true, invoiceType: true,
      payments: { select: { id: true, amount: true, method: true, receiptNo: true, paidAt: true, note: true }, orderBy: { paidAt: 'asc' } },
    },
  };
  try {
    return await prisma.invoice.findMany({
      ...base,
      select: { ...base.select, currency: true, fxRate: true, baseAmount: true },
    }).then((rows) => rows.map((r) => ({
      ...r,
      currency: r.currency || null, fxRate: r.fxRate ? Number(r.fxRate) : null,
      baseAmount: r.baseAmount != null ? Number(r.baseAmount) : null,
    })));
  } catch (e) {
    if (e && (e.code === 'P2022' || /column/i.test(e.message || ''))) {
      return prisma.invoice.findMany(base).then((rows) => rows.map((r) => ({ ...r, currency: null, fxRate: null, baseAmount: null })));
    }
    throw e;
  }
}

async function queryCreditNotes(tf, memberId) {
  return prisma.creditNote.findMany({
    where: { ...tf, memberId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, number: true, amount: true, amountUsed: true, status: true, reason: true, createdAt: true },
  });
}

function fmt(n, cur) {
  const v = Number(n || 0);
  return `${cur} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

// --- core statement builder (JSON + PDF dono use karte hain) ---
async function buildStatement(req, memberId) {
  const tf = tenantFilter(req);
  const baseCurrency = await getBaseCurrency(tf);

  const member = await prisma.member.findFirst({
    where: { id: memberId, ...tf },
    select: { id: true, name: true, email: true, phone: true, companyName: true },
  });
  if (!member) {
    const err = new Error('Member not found');
    err.status = 404;
    throw err;
  }

  const filterCur = req.query.currency ? String(req.query.currency).toUpperCase() : null;

  const invoices = await queryInvoices(tf, memberId);
  const creditNotes = await queryCreditNotes(tf, memberId);

  const lines = [];

  for (const inv of invoices) {
    const cur = inv.currency || baseCurrency;
    if (filterCur && cur !== filterCur) continue;
    const amount = Number(inv.amount);
    const baseAmt = inv.baseAmount != null ? inv.baseAmount : amount; // merge na ho to 1:1
    lines.push({
      date: inv.createdAt, type: 'invoice', ref: inv.number,
      description: `Invoice ${inv.number} (${inv.invoiceType})`,
      currency: cur, amount, baseCurrency, baseAmount: baseAmt, signedBase: baseAmt,
      status: inv.status,
    });
    for (const p of inv.payments) {
      // Payment currency columns (track 4) merge na hue hon to invoice currency assume
      const pCur = p.currency || cur;
      if (filterCur && pCur !== filterCur) continue;
      const pAmt = Number(p.amount);
      const pBase = p.baseAmount != null ? Number(p.baseAmount) : pAmt;
      lines.push({
        date: p.paidAt, type: 'payment', ref: p.receiptNo || inv.number,
        description: `Payment ${p.receiptNo || ''} — ${p.method} (vs ${inv.number})`.trim(),
        currency: pCur, amount: pAmt, baseCurrency, baseAmount: pBase, signedBase: -pBase,
        status: 'paid',
      });
    }
  }

  for (const cn of creditNotes) {
    const cur = cn.currency || baseCurrency; // credit note currency merge baqi
    if (filterCur && cur !== filterCur) continue;
    const amt = Number(cn.amount);
    lines.push({
      date: cn.createdAt, type: 'credit_note', ref: cn.number,
      description: `Credit note ${cn.number}${cn.reason ? ' — ' + cn.reason : ''}`,
      currency: cur, amount: amt, baseCurrency, baseAmount: amt, signedBase: -amt,
      status: cn.status,
    });
  }

  lines.sort((a, b) => new Date(a.date) - new Date(b.date));

  let balance = 0;
  const rows = lines.map((l) => {
    balance = Math.round((balance + l.signedBase) * 100) / 100;
    return { ...l, date: l.date, runningBalance: balance };
  });

  const totals = {
    invoiced: 0, paid: 0, credited: 0, balance: Math.round(balance * 100) / 100,
    byCurrency: {},
  };
  for (const l of lines) {
    if (!totals.byCurrency[l.currency]) totals.byCurrency[l.currency] = { invoiced: 0, paid: 0, credited: 0 };
    if (l.type === 'invoice') { totals.invoiced += l.signedBase; totals.byCurrency[l.currency].invoiced += l.amount; }
    else if (l.type === 'payment') { totals.paid += -l.signedBase; totals.byCurrency[l.currency].paid += l.amount; }
    else { totals.credited += -l.signedBase; totals.byCurrency[l.currency].credited += l.amount; }
  }
  totals.invoiced = Math.round(totals.invoiced * 100) / 100;
  totals.paid = Math.round(totals.paid * 100) / 100;
  totals.credited = Math.round(totals.credited * 100) / 100;

  return { member, baseCurrency, filterCurrency: filterCur, lines: rows, totals, generatedAt: new Date().toISOString() };
}

function checkAccess(req, res, next) {
  const { memberId } = req.params;
  const role = req.user.role;
  if (role === 'member') {
    if (!req.user.memberId || req.user.memberId !== memberId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  }
  if (!STAFF_ROLES.has(role)) return res.status(403).json({ error: 'Forbidden' });
  return next();
}

// GET /api/member-statements/me — member apna statement
router.get('/me', async (req, res, next) => {
  try {
    if (req.user.role !== 'member' || !req.user.memberId) {
      return res.status(403).json({ error: 'Only members can use this endpoint' });
    }
    const st = await buildStatement(req, req.user.memberId);
    return res.json(st);
  } catch (e) { return next(e); }
});

// GET /api/member-statements/me/pdf — member apna statement PDF
router.get('/me/pdf', async (req, res, next) => {
  try {
    if (req.user.role !== 'member' || !req.user.memberId) {
      return res.status(403).json({ error: 'Only members can use this endpoint' });
    }
    const tf = tenantFilter(req);
    const st = await buildStatement(req, req.user.memberId);
    let tenantName = '';
    try {
      const t = await prisma.tenant.findFirst({ where: tf, select: { name: true } });
      tenantName = t ? t.name : '';
    } catch { /* ignore */ }
    const pdf = await generateStatementPdf(st, tenantName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="my-statement.pdf"');
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (e) { return next(e); }
});

// GET /api/member-statements/:memberId
router.get('/:memberId', checkAccess, async (req, res, next) => {
  try {
    const st = await buildStatement(req, req.params.memberId);
    return res.json(st);
  } catch (e) { return next(e); }
});

// --- PDF ---
function generateStatementPdf(st, tenantName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const m = st.member;
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e1b4b').text(tenantName || 'Coworking Space');
    doc.moveDown(0.3);
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e1b4b').text('Member Statement');
    doc.fontSize(10).font('Helvetica').fillColor('#64748b');
    doc.text(`Member: ${m.name}${m.companyName ? ' — ' + m.companyName : ''}`);
    doc.text(`Generated: ${fmtDate(st.generatedAt)}  ·  Base currency: ${st.baseCurrency}`);
    if (st.filterCurrency) doc.text(`Filtered currency: ${st.filterCurrency}`);
    doc.moveDown();

    // Summary
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e1b4b').text('Summary');
    doc.fontSize(10).font('Helvetica').fillColor('#334155');
    doc.text(`Total invoiced (base): ${fmt(st.totals.invoiced, st.baseCurrency)}`);
    doc.text(`Total paid (base): ${fmt(st.totals.paid, st.baseCurrency)}`);
    doc.text(`Total credited (base): ${fmt(st.totals.credited, st.baseCurrency)}`);
    doc.font('Helvetica-Bold').text(`Outstanding balance: ${fmt(st.totals.balance, st.baseCurrency)}`);
    doc.moveDown();

    // Table
    const colX = [50, 130, 330, 430];
    const startY = doc.y;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');
    doc.rect(50, startY, 495, 22).fill('#4c1d95');
    doc.text('Date', colX[0] + 6, startY + 6);
    doc.text('Description', colX[1] + 6, startY + 6);
    doc.text('Amount', colX[2], startY + 6, { width: 90, align: 'right' });
    doc.text('Balance (base)', colX[3], startY + 6, { width: 105, align: 'right' });

    let y = startY + 26;
    doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
    for (const l of st.lines) {
      if (y > 730) { doc.addPage(); y = 60; }
      const sign = l.signedBase < 0 ? '−' : '+';
      doc.text(fmtDate(l.date), colX[0] + 6, y + 5, { width: 70 });
      doc.text(l.description.slice(0, 52), colX[1] + 6, y + 5, { width: 190 });
      doc.text(`${sign} ${fmt(l.amount, l.currency)}`, colX[2], y + 5, { width: 90, align: 'right' });
      doc.text(fmt(l.runningBalance, st.baseCurrency), colX[3], y + 5, { width: 105, align: 'right' });
      y += 18;
    }

    doc.end();
  });
}

// GET /api/member-statements/:memberId/pdf
router.get('/:memberId/pdf', checkAccess, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const st = await buildStatement(req, req.params.memberId);
    let tenantName = '';
    try {
      const t = await prisma.tenant.findFirst({ where: tf, select: { name: true } });
      tenantName = t ? t.name : '';
    } catch { /* ignore */ }
    const pdf = await generateStatementPdf(st, tenantName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${st.member.name.replace(/\s+/g, '-').toLowerCase()}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (e) { return next(e); }
});

module.exports = router;
