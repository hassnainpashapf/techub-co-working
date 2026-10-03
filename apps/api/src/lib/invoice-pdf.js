// Invoice PDF generator using pdfkit.
const PDFDocument = require('pdfkit');

const fmtMoney = (n) => `Rs ${Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

/**
 * Generate an invoice PDF. Returns a Buffer.
 * invoice: full invoice record with member, contract, payments, tenant
 */
function generateInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const tenant = invoice.tenant || {};
    const member = invoice.member || {};

    // Header
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e1b4b').text(tenant.name || 'Coworking Space');
    if (tenant.address) doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(tenant.address);
    if (tenant.phone || tenant.email) {
      doc.fontSize(10).fillColor('#64748b').text([tenant.phone, tenant.email].filter(Boolean).join(' · '));
    }
    doc.moveDown();

    // Title + meta
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e1b4b').text('INVOICE');
    doc.fontSize(11).font('Helvetica').fillColor('#334155');
    doc.text(`Invoice #: ${invoice.number}`);
    doc.text(`Period: ${fmtDate(invoice.periodStart)} – ${fmtDate(invoice.periodEnd)}`);
    doc.text(`Due date: ${fmtDate(invoice.dueDate)}`);
    doc.text(`Status: ${String(invoice.status).toUpperCase()}`);
    doc.moveDown();

    // Bill to
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e1b4b').text('Bill To');
    doc.fontSize(11).font('Helvetica').fillColor('#334155');
    doc.text(member.name || '—');
    if (member.phone) doc.text(`Phone: ${member.phone}`);
    if (member.companyName) doc.text(`Company: ${member.companyName}`);
    doc.moveDown();

    // Line items table
    const startY = doc.y;
    const colX = [50, 330, 430, 545];
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
    doc.rect(50, startY, 495, 22).fill('#4c1d95');
    doc.fillColor('#ffffff');
    doc.text('Description', colX[0] + 8, startY + 6);
    doc.text('Qty', colX[1], startY + 6);
    doc.text('Amount', colX[2], startY + 6, { width: 100, align: 'right' });

    let y = startY + 26;
    const items = [];
    const desc = invoice.contract
      ? `Membership rent — ${invoice.contract.unitId ? 'unit' : ''} ${fmtDate(invoice.periodStart)} to ${fmtDate(invoice.periodEnd)}`
      : `Membership charges — ${fmtDate(invoice.periodStart)} to ${fmtDate(invoice.periodEnd)}`;
    items.push({ desc, qty: 1, amount: Number(invoice.amount) });

    doc.font('Helvetica').fillColor('#1e293b');
    items.forEach((it, i) => {
      doc.rect(50, y, 495, 24).fill(i % 2 === 0 ? '#f8fafc' : '#ffffff');
      doc.fillColor('#1e293b');
      doc.text(it.desc, colX[0] + 8, y + 7, { width: 260 });
      doc.text(String(it.qty), colX[1], y + 7);
      doc.text(fmtMoney(it.amount), colX[2], y + 7, { width: 100, align: 'right' });
      y += 24;
    });

    // Totals
    y += 8;
    const total = Number(invoice.amount);
    const paid = Number(invoice.amountPaid || 0);
    const due = total - paid;
    doc.fontSize(11);
    const totalRow = (label, val, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? '#1e1b4b' : '#334155');
      doc.text(label, 330, y, { width: 100, align: 'right' });
      doc.text(fmtMoney(val), 445, y, { width: 100, align: 'right' });
      y += 18;
    };
    totalRow('Total:', total, false);
    totalRow('Paid:', paid, false);
    totalRow('Balance due:', due, true);

    // Payments
    if (invoice.payments && invoice.payments.length > 0) {
      y += 10;
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e1b4b').text('Payments', 50, y);
      y += 18;
      doc.fontSize(10).font('Helvetica').fillColor('#334155');
      for (const p of invoice.payments) {
        doc.text(`${fmtDate(p.paidAt)} — ${fmtMoney(p.amount)}${p.method ? ` (${p.method})` : ''}`, 50, y);
        y += 15;
      }
    }

    // Notes
    if (invoice.notes) {
      y += 10;
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#64748b').text(`Notes: ${invoice.notes}`, 50, y, { width: 495 });
    }

    // Footer
    doc.fontSize(9).font('Helvetica').fillColor('#94a3b8')
      .text('Thank you for your business.', 50, 760, { align: 'center', width: 495 });
    doc.text(`Generated on ${new Date().toLocaleDateString('en-PK')}`, 50, 775, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generateInvoicePdf };
