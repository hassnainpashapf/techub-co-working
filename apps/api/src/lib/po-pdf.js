// Phase 41 Track 2: Purchase Order PDF generator using pdfkit (branded via white-label).
const PDFDocument = require('pdfkit');

const fmtMoney = (n) => `Rs ${Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

/**
 * Generate a branded purchase order PDF. Returns a Buffer.
 * po: { number, items, subtotal, tax, total, status, notes, createdAt, vendor }
 *     + brand { brandName, supportEmail }
 */
async function generatePOPdf(po) {
  const brand = po.brand || { brandName: 'CoworkOS', supportEmail: null };
  const vendor = po.vendor || {};
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e1b4b').text(brand.brandName || 'CoworkOS');
    if (brand.supportEmail) doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(brand.supportEmail);
    doc.moveDown();

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e1b4b').text('PURCHASE ORDER');
    doc.fontSize(11).font('Helvetica').fillColor('#334155');
    doc.text(`PO #: ${po.number}`);
    doc.text(`Date: ${fmtDate(po.createdAt)}`);
    doc.text(`Status: ${String(po.status).toUpperCase()}`);
    doc.moveDown();

    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e1b4b').text('Vendor');
    doc.fontSize(11).font('Helvetica').fillColor('#334155');
    doc.text(vendor.name || '—');
    if (vendor.company) doc.text(`Company: ${vendor.company}`);
    if (vendor.phone) doc.text(`Phone: ${vendor.phone}`);
    if (vendor.email) doc.text(`Email: ${vendor.email}`);
    if (vendor.address) doc.text(`Address: ${vendor.address}`);
    doc.moveDown();

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
    const items = Array.isArray(po.items) ? po.items : [];
    doc.font('Helvetica').fillColor('#334155');
    for (const it of items) {
      const qty = Number(it.qty) || 0;
      const price = Number(it.price) || 0;
      if (y > 700) { doc.addPage(); y = 60; }
      doc.text(String(it.desc || '—'), colX[0] + 8, y, { width: 320 });
      doc.text(String(qty), colX[1], y);
      doc.text(fmtMoney(price), colX[2], y, { width: 70, align: 'right' });
      doc.text(fmtMoney(qty * price), colX[3] - 95, y, { width: 100, align: 'right' });
      y += 20;
    }

    y = Math.max(doc.y, y) + 6;
    doc.fontSize(11).font('Helvetica').fillColor('#334155');
    doc.text('Subtotal', 380, y, { width: 70, align: 'right' });
    doc.text(fmtMoney(po.subtotal), 450, y, { width: 95, align: 'right' });
    y += 18;
    doc.text('Tax', 380, y, { width: 70, align: 'right' });
    doc.text(fmtMoney(po.tax), 450, y, { width: 95, align: 'right' });
    y += 18;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e1b4b');
    doc.text('Total', 380, y, { width: 70, align: 'right' });
    doc.text(fmtMoney(po.total), 450, y, { width: 95, align: 'right' });

    doc.moveDown(2);
    if (po.notes) {
      doc.fontSize(10).font('Helvetica').fillColor('#64748b').text('Notes:');
      doc.text(po.notes);
    }
    doc.end();
  });
}

module.exports = { generatePOPdf };
