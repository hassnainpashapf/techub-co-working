// Phase 30 Track 2/10: CSV import for members + units (no new models).
const express = require('express');
const multer = require('multer');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const router = express.Router();
router.use(authenticate, requireTenantUser);

const canImport = requireRole('ceo', 'admin', 'manager', 'super_admin');

const MEMBER_STATUSES = ['active', 'trial', 'on_hold', 'exited'];
const UNIT_TYPES = ['hot_desk', 'dedicated_desk', 'cabin', 'meeting_room', 'phone_booth', 'virtual_office', 'accommodation'];
const UNIT_STATUSES = ['vacant', 'occupied', 'maintenance'];
const MAX_ROWS = 2000;

// ------------------------------------------------------------ CSV parsing ---
// Minimal RFC-4180 parser (quoted fields, escaped quotes, CRLF). No deps.
function parseCsv(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // ignore, \n handles the break
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function rowsToObjects(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const records = rows.slice(1).map((r, idx) => {
    const obj = { __row: idx + 2 }; // 1-based CSV line number
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
  return { headers, records };
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// ---------------------------------------------------------------- templates -
const MEMBER_TEMPLATE = 'name,email,phone,company,status\nAhmed Khan,ahmed@example.com,03001234567,Acme Corp,active\n';
const UNIT_TEMPLATE = 'code,buildingId,type,capacity,monthlyPrice,status\nHD-01,Gulberg Campus,hot_desk,1,15000,vacant\n';

router.get('/templates/members', canImport, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="members-template.csv"');
  res.send(MEMBER_TEMPLATE);
});

router.get('/templates/units', canImport, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="units-template.csv"');
  res.send(UNIT_TEMPLATE);
});

// ------------------------------------------------------------------ members -
router.post('/members', canImport, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: 'CSV file is required (field "file").' } });
    const { records } = rowsToObjects(parseCsv(req.file.buffer.toString('utf8')));
    if (!records.length) return res.status(400).json({ error: { message: 'CSV has no data rows.' } });
    if (records.length > MAX_ROWS) return res.status(400).json({ error: { message: `Too many rows (max ${MAX_ROWS}).` } });

    const { tenantId } = tenantFilter(req);
    const existingEmails = new Set(
      (await prisma.member.findMany({ where: { tenantId, email: { not: null } }, select: { email: true } }))
        .map((m) => m.email.toLowerCase())
    );
    const seenInFile = new Set();
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const r of records) {
      const name = r.name || '';
      const phone = r.phone || '';
      const email = r.email || '';
      const status = (r.status || 'active').toLowerCase();
      if (!name) { errors.push({ row: r.__row, message: 'name is required' }); continue; }
      if (!phone) { errors.push({ row: r.__row, message: 'phone is required' }); continue; }
      if (email && !isEmail(email)) { errors.push({ row: r.__row, message: `invalid email "${email}"` }); continue; }
      if (!MEMBER_STATUSES.includes(status)) { errors.push({ row: r.__row, message: `invalid status "${r.status}"` }); continue; }
      const emailKey = email.toLowerCase();
      if (email && (existingEmails.has(emailKey) || seenInFile.has(emailKey))) { skipped++; continue; }
      try {
        await prisma.member.create({
          data: {
            tenantId,
            name,
            email: email || null,
            phone,
            companyName: r.company || null,
            status,
          },
        });
        imported++;
        if (email) { existingEmails.add(emailKey); seenInFile.add(emailKey); }
      } catch (e) {
        errors.push({ row: r.__row, message: 'create failed' });
      }
    }

    await writeAudit({
      tenantId, actorId: req.user.sub, action: 'import.members', entity: 'Member',
      newValue: { imported, skipped, errors: errors.length },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.json({ imported, skipped, errors });
  } catch (err) {
    return next(err);
  }
});

// -------------------------------------------------------------------- units -
async function resolveZone(tenantId, buildingRef) {
  if (!buildingRef) return { error: 'buildingId is required' };
  let building = await prisma.building.findFirst({ where: { id: buildingRef, tenantId } });
  if (!building) {
    building = await prisma.building.findFirst({
      where: { tenantId, name: { equals: buildingRef, mode: 'insensitive' } },
    });
  }
  if (!building) return { error: `building not found: "${buildingRef}"` };
  const floor = await prisma.floor.findFirst({
    where: { buildingId: building.id, tenantId },
    orderBy: { level: 'asc' },
    include: { zones: { orderBy: { name: 'asc' }, take: 1 } },
  });
  if (!floor || !floor.zones.length) return { error: `building "${building.name}" has no zones yet` };
  return { zone: floor.zones[0], building };
}

router.post('/units', canImport, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: 'CSV file is required (field "file").' } });
    const { records } = rowsToObjects(parseCsv(req.file.buffer.toString('utf8')));
    if (!records.length) return res.status(400).json({ error: { message: 'CSV has no data rows.' } });
    if (records.length > MAX_ROWS) return res.status(400).json({ error: { message: `Too many rows (max ${MAX_ROWS}).` } });

    const { tenantId } = tenantFilter(req);
    const existingCodes = new Set(
      (await prisma.unit.findMany({ where: { tenantId }, select: { code: true } }))
        .map((u) => u.code.toLowerCase())
    );
    const seenInFile = new Set();
    const zoneCache = new Map(); // buildingRef -> {zone, building} | {error}
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const r of records) {
      const code = r.code || '';
      const type = (r.type || '').toLowerCase();
      const status = (r.status || 'vacant').toLowerCase();
      if (!code) { errors.push({ row: r.__row, message: 'code is required' }); continue; }
      if (!UNIT_TYPES.includes(type)) { errors.push({ row: r.__row, message: `invalid type "${r.type}"` }); continue; }
      if (!UNIT_STATUSES.includes(status)) { errors.push({ row: r.__row, message: `invalid status "${r.status}"` }); continue; }
      const codeKey = code.toLowerCase();
      if (existingCodes.has(codeKey) || seenInFile.has(codeKey)) { skipped++; continue; }
      const capacity = r.capacity ? parseInt(r.capacity, 10) : 1;
      if (Number.isNaN(capacity) || capacity < 1) { errors.push({ row: r.__row, message: `invalid capacity "${r.capacity}"` }); continue; }
      const monthlyPrice = r.monthlyprice ? parseFloat(r.monthlyprice) : 0;
      if (Number.isNaN(monthlyPrice) || monthlyPrice < 0) { errors.push({ row: r.__row, message: `invalid monthlyPrice "${r.monthlyprice}"` }); continue; }

      const ref = r.buildingid || '';
      if (!zoneCache.has(ref)) zoneCache.set(ref, await resolveZone(tenantId, ref));
      const resolved = zoneCache.get(ref);
      if (resolved.error) { errors.push({ row: r.__row, message: resolved.error }); continue; }

      try {
        await prisma.unit.create({
          data: {
            tenantId,
            zoneId: resolved.zone.id,
            code,
            type,
            status,
            capacity,
            monthlyPrice,
          },
        });
        imported++;
        existingCodes.add(codeKey); seenInFile.add(codeKey);
      } catch (e) {
        errors.push({ row: r.__row, message: 'create failed' });
      }
    }

    await writeAudit({
      tenantId, actorId: req.user.sub, action: 'import.units', entity: 'Unit',
      newValue: { imported, skipped, errors: errors.length },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.json({ imported, skipped, errors });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
