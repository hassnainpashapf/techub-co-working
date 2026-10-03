// Report export helpers — CSV / XLSX / PDF (koi naya npm package nahi).
// XLSX: pure-JS "store" (uncompressed) ZIP writer — Excel/LibreOffice kholte hain.
const PDFDocument = require('pdfkit');

// ---------- value formatting ----------
function fmtCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (typeof v.toNumber === 'function') return String(v.toNumber());
    return JSON.stringify(v);
  }
  return String(v);
}

// ---------- CSV ----------
const escCsv = (s) => {
  const t = fmtCell(s);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
function toCsv(headers, rows) {
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(escCsv).join(',')).join('\n');
}

// ---------- minimal ZIP (store only) ----------
function crc32Table() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC_T = crc32Table();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  // files: [{name, data: Buffer}]
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); // store
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + f.data.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------- XLSX ----------
const escXml = (s) => fmtCell(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colLetter(i) {
  let s = '';
  i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function toXlsx(headers, rows) {
  const all = [headers, ...rows];
  const sheetRows = all.map((r, ri) => {
    const cells = r.map((c, ci) => `<c r="${colLetter(ci)}${ri + 1}" t="inlineStr"><is><t>${escXml(c)}</t></is></c>`).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts><font><b/></font><font/></fonts><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E1B4B"/><bgColor indexed="64"/></patternFill></fill></fills><borders><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`) },
  ];
  return zipStore(files);
}

// ---------- PDF (pdfkit table) ----------
function toPdf(title, headers, rows) {
  return (async () => {
    const landscape = headers.length > 6;
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

    const pageW = (landscape ? 842 : 595) - 72;
    const colW = Math.max(60, Math.min(180, pageW / Math.max(headers.length, 1)));
    const rowH = 18;

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e1b4b').text(title || 'Report');
    doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(`Generated: ${new Date().toLocaleString('en-PK')} · Rows: ${rows.length}`);
    doc.moveDown(0.5);

    const drawHeader = (y) => {
      doc.fillColor('#1e1b4b').rect(36, y, colW * headers.length, rowH).fill();
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      headers.forEach((h, i) => doc.text(fmtCell(h).slice(0, 40), 36 + i * colW + 4, y + 5, { width: colW - 8 }));
      return y + rowH;
    };
    let y = drawHeader(doc.y + 4);
    doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
    rows.forEach((r, ri) => {
      if (y + rowH > doc.page.height - 50) { doc.addPage(); y = drawHeader(50); doc.font('Helvetica').fontSize(8).fillColor('#1e293b'); }
      if (ri % 2 === 1) doc.fillColor('#f1f5f9').rect(36, y, colW * headers.length, rowH).fill();
      doc.fillColor('#1e293b');
      headers.forEach((_, i) => doc.text(fmtCell(r[i]).slice(0, 60), 36 + i * colW + 4, y + 5, { width: colW - 8 }));
      y += rowH;
    });
    doc.end();
    return done;
  })();
}

const slugify = (s) => String(s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report';

module.exports = { fmtCell, toCsv, toXlsx, toPdf, slugify };
