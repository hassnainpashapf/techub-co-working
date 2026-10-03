// Phase 31 Track 4: Tax reports.
// NOTE: Invoice model has no tax columns, so tax is derived: invoice `amount`
// is treated as the pre-tax subtotal; tax = subtotal * taxRate. taxRate is read
// from tenant Settings key "taxRate" (percent, e.g. "16" = 16%), default 0.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'finance_officer'));

const num = (v) => Number(v) || 0;

async function getTaxRate(tenantId) {
  try {
    const row = await prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key: 'taxRate' } },
    });
    const v = parseFloat(row && row.value);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
}

function parseRange(req) {
  const { from, to } = req.query;
  const where = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59`);
  }
  return where;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// GET /api/tax-reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/summary', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const taxRate = await getTaxRate(req.user.tenantId);
    const invoices = await prisma.invoice.findMany({
      where: { ...tf, ...parseRange(req) },
      select: { amount: true, amountPaid: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    let totalInvoiced = 0;
    let totalPaid = 0;
    const byMonthMap = new Map();

    for (const inv of invoices) {
      const sub = num(inv.amount);
      const tax = sub * (taxRate / 100);
      totalInvoiced += sub;
      totalPaid += num(inv.amountPaid);
      const k = monthKey(new Date(inv.createdAt));
      if (!byMonthMap.has(k)) byMonthMap.set(k, { month: k, invoiced: 0, tax: 0, paid: 0 });
      const m = byMonthMap.get(k);
      m.invoiced += sub;
      m.tax += tax;
      m.paid += num(inv.amountPaid);
    }

    const totalTax = totalInvoiced * (taxRate / 100);
    const byMonth = [...byMonthMap.values()].map((m) => ({
      month: m.month,
      invoiced: Math.round(m.invoiced * 100) / 100,
      tax: Math.round(m.tax * 100) / 100,
      paid: Math.round(m.paid * 100) / 100,
    }));

    return res.json({
      taxRate,
      assumption: 'Invoice amount treated as pre-tax subtotal; tax = subtotal * taxRate/100.',
      invoiceCount: invoices.length,
      totalInvoiced: Math.round(totalInvoiced * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      totalWithTax: Math.round((totalInvoiced + totalTax) * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalOutstanding: Math.round((totalInvoiced - totalPaid) * 100) / 100,
      byMonth,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/tax-reports/export?from=&to= — CSV download
router.get('/export', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const taxRate = await getTaxRate(req.user.tenantId);
    const invoices = await prisma.invoice.findMany({
      where: { ...tf, ...parseRange(req) },
      select: {
        number: true,
        createdAt: true,
        amount: true,
        amountPaid: true,
        status: true,
        member: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = ['\uFEFFInvoice Number,Date,Member,Subtotal,Tax Rate %,Tax Amount,Total,Amount Paid,Status'];
    for (const inv of invoices) {
      const sub = num(inv.amount);
      const tax = sub * (taxRate / 100);
      lines.push([
        esc(inv.number),
        esc(new Date(inv.createdAt).toISOString().slice(0, 10)),
        esc(inv.member && inv.member.name),
        sub.toFixed(2),
        taxRate,
        tax.toFixed(2),
        (sub + tax).toFixed(2),
        num(inv.amountPaid).toFixed(2),
        esc(inv.status),
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tax-report.csv"');
    return res.send(lines.join('\n'));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
