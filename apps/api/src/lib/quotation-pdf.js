// Phase 39 Track 4: Quotation PDF generator using pdfkit (branded via white-label).
const PDFDocument = require('pdfkit');
const { getTenantBrand } = require('./mailer');

const fmtMoney = (n) => `Rs ${Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

/**
 * Generate a branded quotation PDF. Returns a Buffer.
 * quotation: record with number, items, total, validTill, status, notes, createdAt
 *            + lead { name, email, phone, company } + tenantId
 */
async function generateQuotationPdf(quotation) {
  const brand = await getTenantBrand(quotation.tenantId).catch(() => ({ brandName: 'CoworkOS', supportEmail: null }));
  const lead = quotation.lead || {};
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header — brand
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e1b4b').text(brand.brandName || 'CoworkOS');
    if (brand.supportEmail) doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(brand.supportEmail);
    doc.moveDown();

    // Title + meta
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e1b4b').text('QUOTATION');
    doc.fontSize(11).font('Helvetica').fillColor('#334155');
    doc.text(`Quotation #: ${quotation.number}`);
    doc.text(`Date: ${fmtDate(quotation.createdAt)}`);
    doc.text(`Valid till: ${fmtDate(quotation.validTill)}`);
    doc.text(`Status: ${String(quotation.status).toUpperCase()}`);
    doc.moveDown();

    // Prepared for
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e1b4b').text('Prepared For');
    doc.fontSize(11).font('Helvetica').fillColor('#334155');
    doc.text(lead.name || '—');
    if (lead.company) doc.text(`Company: ${lead.company}`);
    if (lead.phone) doc.text(`Phone: ${lead.phone}`);
    if (lead.email) doc.text(`Email: ${lead.email}`);
    doc.moveDown();

    // Line items table
    const startY = doc.y;
    const colX = [50, 380, 460, 545];
    doc.fontSize(11).font('Helvetica-Bold');
    doc.rect(50, startY, 495, 22).fill('#4c1d95');
    doc.fillColor('#ffffff');
    doc.text('Description', colX[0] + 8, startY + 6);
    doc.text('Qty', colX[1], startY + 6);
    doc.text('Price', colX[2], startY + 6, { width: 70, align: 'right' });
    doc.text('Amount', colX[3] - 95, startY + 6, { width: 100, align: 'right' });

    let y = startY + 26;
    const items = Array.isArray(quotation.items) ? quotation.items : [];
    doc.font('Helvetica').fillColor('#334155');
    for (const it of items) {
      const qty = Number(it.qty) || 0;
      const price = Number(it.price) || 0;
      const amt = qty * price;
      if (y > 700) { doc.addPage(); y = 60; }
      doc.text(String(it.desc || '—'), colX[0] + 8, y, { width: 320 });
      doc.text(String(qty), colX[1], y);
      doc.text(fmtMoney(price), colX[2], y, { width: 70, align: 'right' });
      doc.text(fmtMoney(amt), colX[3] - 95, y, { width: 100, align: 'right' });
      y += 20;
    }

    // Total
    doc.moveDown(0.5);
    y = Math.max(doc.y, y) + 6;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e1b4b');
    doc.text('Total', 380, y, { width: 70, align: 'right' });
    doc.text(fmtMoney(quotation.total), 450, y, { width: 95, align: 'right' });

    doc.moveDown(2);
    if (quotation.notes) {
      doc.fontSize(10).font('Helvetica').fillColor('#64748b').text('Notes:');
      doc.text(quotation.notes);
    }
    doc.moveDown();
    doc.fontSize(10).fillColor('#94a3b8').text(`This quotation is valid until ${fmtDate(quotation.validTill)}. Prices include applicable taxes unless stated otherwise.`);

    doc.end();
  });
}

module.exports = { generateQuotationPdf };
