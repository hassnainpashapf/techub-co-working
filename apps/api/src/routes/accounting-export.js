// Phase 36 Track 8: Accounting Export (Xero/QuickBooks).
// Exports invoices, bills (expenses) and payments as CSVs in Xero's
// documented import column format so they can be imported directly into
// Xero (or QuickBooks, which accepts the same layout for most columns).
// Xero dates are DD/MM/YYYY; amounts are tax-exclusive UnitAmount; TaxType
// "None" means no tax (our invoices carry no per-line tax), AccountCode
// defaults to Xero's "200 - Sales" / "310 - Cost of Sales" conventions.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'finance_officer'));

const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const money = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
const xeroDate = (d) => {
  if (!d) return '';
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
};

function dateFilter(field, from, to) {
  const w = {};
  if (from || to) {
    w[field] = {};
    if (from) w[field].gte = new Date(`${from}T00:00:00`);
    if (to) w[field].lte = new Date(`${to}T23:59:59`);
  }
  return w;
}

function sendCsv(res, filename, header, lines) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send('﻿' + [header, ...lines].join('\n'));
}

// GET /api/accounting-export/invoices.csv?from=&to=
// Xero sales-invoice import columns:
// InvoiceNumber,Reference,ContactName,InvoiceDate,DueDate,Description,
// Quantity,UnitAmount,Discount,AccountCode,TaxType,TaxAmount,Currency
router.get('/invoices.csv', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = {
      ...tenantFilter(req),
      invoiceType: 'standard', // proforma = quotes, never accounting revenue
      ...dateFilter('createdAt', from, to),
    };
    const invoices = await prisma.invoice.findMany({
      where,
      include: { member: { select: { name: true, companyName: true } }, contract: { select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const header = ['InvoiceNumber', 'Reference', 'ContactName', 'InvoiceDate', 'DueDate',
      'Description', 'Quantity', 'UnitAmount', 'Discount', 'AccountCode', 'TaxType', 'TaxAmount', 'Currency']
      .map(esc).join(',');
    const lines = invoices.map((inv) => {
      const contact = inv.member?.companyName || inv.member?.name || 'Unknown';
      const desc = inv.contractId
        ? `Coworking contract billing (${inv.number})`
        : `Ad-hoc invoice (${inv.number})${inv.notes ? ' - ' + inv.notes : ''}`;
      return [
        esc(inv.number),
        esc(inv.id.slice(-8)),
        esc(contact),
        esc(xeroDate(inv.periodStart || inv.createdAt)),
        esc(xeroDate(inv.dueDate)),
        esc(desc),
        esc(1),
        esc(money(inv.amount)),
        esc(0),
        esc('200'), // Xero default sales account code
        esc('None'), // invoices carry no per-line tax
        esc(0),
        esc('PKR'),
      ].join(',');
    });
    return sendCsv(res, `invoices-${from || 'all'}-to-${to || 'all'}.csv`, header, lines);
  } catch (err) {
    return next(err);
  }
});

// GET /api/accounting-export/bills.csv?from=&to=
// Xero bill (purchase invoice) import columns:
// BillNumber,Reference,ContactName,InvoiceDate,DueDate,Description,
// Quantity,UnitAmount,Discount,AccountCode,TaxType,TaxAmount,Currency
router.get('/bills.csv', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const expenses = await prisma.expense.findMany({
      where: {
        ...tenantFilter(req),
        status: 'approved', // only approved expenses hit the books
        ...dateFilter('date', from, to),
      },
      orderBy: { date: 'asc' },
    });

    const header = ['BillNumber', 'Reference', 'ContactName', 'InvoiceDate', 'DueDate',
      'Description', 'Quantity', 'UnitAmount', 'Discount', 'AccountCode', 'TaxType', 'TaxAmount', 'Currency']
      .map(esc).join(',');
    const lines = expenses.map((e) => [
      esc(`BILL-${e.id.slice(-8).toUpperCase()}`),
      esc(e.paidBy || ''),
      esc(e.note ? 'Supplier' : 'Supplier'),
      esc(xeroDate(e.date)),
      esc(xeroDate(e.date)),
      esc(`[${e.category}] ${e.note || 'Expense'}`),
      esc(1),
      esc(money(e.amount)),
      esc(0),
      esc('310'), // Xero default cost-of-sales account code
      esc('None'),
      esc(0),
      esc('PKR'),
    ].join(','));
    return sendCsv(res, `bills-${from || 'all'}-to-${to || 'all'}.csv`, header, lines);
  } catch (err) {
    return next(err);
  }
});

// GET /api/accounting-export/payments.csv?from=&to=
// Bank-statement style CSV (works with Xero bank-statement import):
// Date,Amount,Description,Reference
router.get('/payments.csv', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const payments = await prisma.payment.findMany({
      where: { ...tenantFilter(req), ...dateFilter('paidAt', from, to) },
      include: { invoice: { select: { number: true } } },
      orderBy: { paidAt: 'asc' },
    });

    const header = ['Date', 'Amount', 'Description', 'Reference'].map(esc).join(',');
    const lines = payments.map((p) => [
      esc(xeroDate(p.paidAt)),
      esc(money(p.amount)),
      esc(`Payment for ${p.invoice?.number || 'invoice'} via ${p.method}`),
      esc(p.receiptNo || p.id.slice(-8)),
    ].join(','));
    return sendCsv(res, `payments-${from || 'all'}-to-${to || 'all'}.csv`, header, lines);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
