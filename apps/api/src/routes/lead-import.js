// Phase 39 Track 10/10: Bulk lead import — two-step flow (upload → validate → confirm).
// Reuses the member import (phase 38) pattern. No new models.
const express = require('express');
const multer = require('multer');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

const router = express.Router();
router.use(authenticate, requireTenantUser);

// NOTE: there is no 'sales' role in this codebase — same roles as /api/leads.
const canImport = requireRole('ceo', 'admin', 'super_admin', 'manager');

const MAX_ROWS = 1000;
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const VALID_SOURCES = ['walkin', 'website', 'referral', 'social', 'other', 'import'];

// ------------------------------------------------------------ CSV parsing ---
// RFC-4180: quoted fields, escaped quotes, CRLF safe.
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

// Canonical field aliases for auto column mapping.
const FIELD_ALIASES = {
  name: ['name', 'full name', 'fullname', 'lead name', 'leadname'],
  email: ['email', 'e-mail', 'e mail', 'email address', 'emailaddress'],
  phone: ['phone', 'phone number', 'phonenumber', 'mobile', 'contact', 'tel'],
  company: ['company', 'company name', 'companyname', 'organization', 'organisation'],
  source: ['source', 'lead source', 'leadsource', 'channel'],
  interestedIn: ['interestedin', 'interested in', 'interest', 'requirement', 'looking for', 'plan', 'workspace'],
  budget: ['budget', 'monthly budget', 'expected budget'],
  notes: ['notes', 'note', 'comments', 'remarks'],
};
const CANONICAL = Object.keys(FIELD_ALIASES);

function autoMap(headers) {
  const map = {};
  headers.forEach((h) => {
    const norm = String(h).trim().toLowerCase().replace(/[_\-]+/g, ' ');
    for (const f of CANONICAL) {
      if (FIELD_ALIASES[f].includes(norm)) { map[h] = f; break; }
    }
  });
  return map;
}

// ------------------------------------------------------------ validation ---
async function validateRows(tenantId, records, mapping) {
  const existing = await prisma.lead.findMany({
    where: { tenantId },
    select: { email: true, phone: true },
  });
  const dbEmails = new Set(existing.map((l) => (l.email || '').toLowerCase()).filter(Boolean));
  const dbPhones = new Set(existing.map((l) => (l.phone || '').trim()).filter(Boolean));
  const seenEmails = new Set();
  const seenPhones = new Set();

  return records.map((r, idx) => {
    const get = (f) => {
      const header = Object.keys(mapping).find((h) => mapping[h] === f);
      return header ? String(r[header] ?? '').trim() : '';
    };
    const rawBudget = get('budget');
    const data = {
      name: get('name'),
      email: get('email'),
      phone: get('phone'),
      company: get('company'),
      source: (get('source') || 'import').toLowerCase(),
      interestedIn: get('interestedIn'),
      budget: rawBudget,
      notes: get('notes'),
    };
    const errors = [];
    const warnings = [];
    if (!data.name) errors.push('name is required');
    if (!data.email && !data.phone) warnings.push('no email or phone — follow-up will be hard');
    if (data.email && !isEmail(data.email)) errors.push(`invalid email "${data.email}"`);
    if (!VALID_SOURCES.includes(data.source)) errors.push(`invalid source "${get('source')}" — use ${VALID_SOURCES.join(', ')}`);
    if (rawBudget && Number.isNaN(Number(rawBudget))) errors.push(`invalid budget "${rawBudget}" — must be a number`);
    const eKey = data.email.toLowerCase();
    const pKey = data.phone.trim();
    if (data.email && (dbEmails.has(eKey) || seenEmails.has(eKey))) errors.push(`duplicate email "${data.email}"`);
    if (data.phone && (dbPhones.has(pKey) || seenPhones.has(pKey))) errors.push(`duplicate phone "${data.phone}"`);
    if (!errors.length) {
      if (eKey) seenEmails.add(eKey);
      if (pKey) seenPhones.add(pKey);
    }
    return {
      row: idx + 2,
      data,
      errors,
      warnings,
      valid: errors.length === 0,
    };
  });
}

// ---------------------------------------------------------------- template --
const LEAD_TEMPLATE = 'name,email,phone,company,source,interestedIn,budget,notes\nAhmed Khan,ahmed@example.com,03001234567,Acme Corp,website,Hot Desk,25000,Wants a corner seat\nSara Malik,sara@example.com,03007654321,,referral,Private Office,80000,\n';

router.get('/template', canImport, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leads-import-template.csv"');
  res.send(LEAD_TEMPLATE);
});

// ------------------------------------------------------------------ upload --
router.post('/upload', canImport, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: 'CSV file is required (field "file").' } });
    const rows = parseCsv(req.file.buffer.toString('utf8'));
    if (rows.length < 2) return res.status(400).json({ error: { message: 'CSV has no data rows.' } });
    if (rows.length - 1 > MAX_ROWS) return res.status(400).json({ error: { message: `Too many rows (max ${MAX_ROWS}).` } });

    const headers = rows[0].map((h) => String(h).trim());
    let mapping = autoMap(headers);
    if (req.body && req.body.mapping) {
      try {
        const custom = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping;
        for (const [h, f] of Object.entries(custom)) {
          if (CANONICAL.includes(f)) mapping[h] = f;
        }
      } catch { /* ignore bad mapping */ }
    }

    const records = rows.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });

    const { tenantId } = tenantFilter(req);
    const results = await validateRows(tenantId, records, mapping);
    const valid = results.filter((x) => x.valid).length;
    const invalid = results.length - valid;

    return res.json({
      headers,
      suggestedMapping: mapping,
      mappedFields: [...new Set(Object.values(mapping))],
      unmappedHeaders: headers.filter((h) => !mapping[h]),
      total: results.length,
      valid,
      invalid,
      rows: results,
    });
  } catch (err) {
    return next(err);
  }
});

// ----------------------------------------------------------------- confirm --
router.post('/confirm', canImport, async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const assignTo = req.body.assignTo ? String(req.body.assignTo).trim() : null;
    if (!rows.length) return res.status(400).json({ error: { message: 'No rows to import.' } });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: { message: `Too many rows (max ${MAX_ROWS}).` } });

    const { tenantId } = tenantFilter(req);
    const { sub: actorId } = req.user || {};

    // Verify assignee belongs to this tenant.
    let assigneeId = null;
    if (assignTo) {
      const user = await prisma.user.findFirst({
        where: { id: assignTo, tenantId },
        select: { id: true, name: true },
      });
      if (!user) return res.status(400).json({ error: { message: 'assignTo user not found in this workspace.' } });
      assigneeId = user.id;
    }

    const dbEmails = new Set(
      (await prisma.lead.findMany({ where: { tenantId, email: { not: null } }, select: { email: true } }))
        .map((l) => l.email.toLowerCase())
    );
    const dbPhones = new Set(
      (await prisma.lead.findMany({ where: { tenantId }, select: { phone: true } }))
        .map((l) => (l.phone || '').trim()).filter(Boolean)
    );

    let imported = 0;
    let skipped = 0;
    const errors = [];

    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      for (const r of chunk) {
        const name = String(r.name || '').trim();
        const email = String(r.email || '').trim() || null;
        const phone = String(r.phone || '').trim() || null;
        const company = String(r.company || '').trim() || null;
        const source = String(r.source || 'import').toLowerCase();
        const interest = String(r.interestedIn || '').trim() || null;
        const notes = String(r.notes || '').trim() || null;
        const budgetRaw = String(r.budget || '').trim();
        if (!name) { skipped++; continue; }
        if (email && !isEmail(email)) { errors.push({ row: r.row, message: `invalid email "${email}"` }); skipped++; continue; }
        if (!VALID_SOURCES.includes(source)) { errors.push({ row: r.row, message: `invalid source "${source}"` }); skipped++; continue; }
        const budget = budgetRaw === '' ? null : Number(budgetRaw);
        if (budget !== null && Number.isNaN(budget)) { errors.push({ row: r.row, message: `invalid budget "${budgetRaw}"` }); skipped++; continue; }
        const eKey = (email || '').toLowerCase();
        if ((email && dbEmails.has(eKey)) || (phone && dbPhones.has(phone))) { skipped++; continue; }
        try {
          await prisma.lead.create({
            data: {
              tenantId,
              name,
              email,
              phone,
              company,
              source: 'import',
              interest,
              budget,
              notes,
              stage: 'new',
              assignedTo: assigneeId,
            },
          });
          imported++;
          if (email) dbEmails.add(eKey);
          if (phone) dbPhones.add(phone);
        } catch (e) {
          errors.push({ row: r.row, message: 'create failed' });
          skipped++;
        }
      }
    }

    await writeAudit({
      tenantId, actorId, action: 'lead_import.confirm', entity: 'Lead',
      newValue: { imported, skipped, assigneeId, errors: errors.length },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.json({ imported, skipped, errors });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
