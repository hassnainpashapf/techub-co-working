// Phase 38 Track 4/10: Bulk member import — two-step flow (upload → validate → confirm).
// No new models. Complements /api/import (one-step) with preview + column mapping.
const express = require('express');
const multer = require('multer');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { sendEmail, getTenantBrand } = require('../lib/mailer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

const router = express.Router();
router.use(authenticate, requireTenantUser);

const canImport = requireRole('ceo', 'admin', 'super_admin');

const MEMBER_STATUSES = ['active', 'trial', 'on_hold', 'exited'];
const MAX_ROWS = 1000;
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

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
  name: ['name', 'full name', 'fullname', 'member name', 'membername'],
  email: ['email', 'e-mail', 'e mail', 'email address', 'emailaddress'],
  phone: ['phone', 'phone number', 'phonenumber', 'mobile', 'contact', 'tel'],
  company: ['company', 'company name', 'companyname', 'organization', 'organisation'],
  plan: ['plan', 'membership plan', 'membershipplan', 'package'],
  status: ['status', 'member status', 'memberstatus'],
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
  const plans = await prisma.membershipPlan.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true },
  });
  const planByName = new Map(plans.map((p) => [p.name.toLowerCase(), p]));

  const existing = await prisma.member.findMany({
    where: { tenantId },
    select: { email: true, phone: true },
  });
  const dbEmails = new Set(existing.map((m) => (m.email || '').toLowerCase()).filter(Boolean));
  const dbPhones = new Set(existing.map((m) => (m.phone || '').trim()).filter(Boolean));
  const seenEmails = new Set();
  const seenPhones = new Set();

  return records.map((r, idx) => {
    const get = (f) => {
      const header = Object.keys(mapping).find((h) => mapping[h] === f);
      return header ? String(r[header] ?? '').trim() : '';
    };
    const data = {
      name: get('name'),
      email: get('email'),
      phone: get('phone'),
      company: get('company'),
      planName: get('plan'),
      status: (get('status') || 'active').toLowerCase(),
    };
    const errors = [];
    const warnings = [];
    if (!data.name) errors.push('name is required');
    if (!data.phone) errors.push('phone is required');
    if (data.email && !isEmail(data.email)) errors.push(`invalid email "${data.email}"`);
    if (!MEMBER_STATUSES.includes(data.status)) errors.push(`invalid status "${get('status')}"`);
    const eKey = data.email.toLowerCase();
    const pKey = data.phone.trim();
    if (data.email && (dbEmails.has(eKey) || seenEmails.has(eKey))) errors.push(`duplicate email "${data.email}"`);
    if (data.phone && (dbPhones.has(pKey) || seenPhones.has(pKey))) warnings.push(`duplicate phone "${data.phone}"`);
    let planId = null;
    if (data.planName) {
      const plan = planByName.get(data.planName.toLowerCase());
      if (plan) planId = plan.id;
      else warnings.push(`plan "${data.planName}" not found — imported without plan`);
    }
    if (!errors.length) {
      if (eKey) seenEmails.add(eKey);
      if (pKey) seenPhones.add(pKey);
    }
    return {
      row: idx + 2,
      data: { ...data, planId },
      errors,
      warnings,
      valid: errors.length === 0,
    };
  });
}

// ---------------------------------------------------------------- template --
const MEMBER_TEMPLATE = 'name,email,phone,company,plan,status\nAhmed Khan,ahmed@example.com,03001234567,Acme Corp,Hot Desk Monthly,active\nSara Malik,sara@example.com,03007654321,,Dedicated Desk Monthly,trial\n';

router.get('/template', canImport, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="members-import-template.csv"');
  res.send(MEMBER_TEMPLATE);
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
    // Optional explicit mapping override: JSON {csvHeader: canonicalField}
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
    const mappedFields = [...new Set(Object.values(mapping))];

    return res.json({
      headers,
      suggestedMapping: mapping,
      mappedFields,
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
    const sendWelcomeEmail = !!req.body.sendWelcomeEmail;
    if (!rows.length) return res.status(400).json({ error: { message: 'No rows to import.' } });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: { message: `Too many rows (max ${MAX_ROWS}).` } });

    const { tenantId } = tenantFilter(req);
    const { sub: actorId } = req.user || {};
    const brand = await getTenantBrand(tenantId).catch(() => ({ brandName: 'Techub' }));

    const dbEmails = new Set(
      (await prisma.member.findMany({ where: { tenantId, email: { not: null } }, select: { email: true } }))
        .map((m) => m.email.toLowerCase())
    );
    const dbPhones = new Set(
      (await prisma.member.findMany({ where: { tenantId }, select: { phone: true } }))
        .map((m) => (m.phone || '').trim()).filter(Boolean)
    );

    let imported = 0;
    let skipped = 0;
    let emailsQueued = 0;
    const errors = [];

    // Process in chunks to keep the transaction small.
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      for (const r of chunk) {
        const name = String(r.name || '').trim();
        const phone = String(r.phone || '').trim();
        const email = String(r.email || '').trim() || null;
        const company = String(r.company || '').trim() || null;
        const status = MEMBER_STATUSES.includes(String(r.status || '').toLowerCase()) ? String(r.status).toLowerCase() : 'active';
        if (!name || !phone) { skipped++; continue; }
        if (email && !isEmail(email)) { errors.push({ row: r.row, message: `invalid email "${email}"` }); skipped++; continue; }
        const eKey = (email || '').toLowerCase();
        if ((email && dbEmails.has(eKey)) || dbPhones.has(phone)) { skipped++; continue; }
        try {
          const member = await prisma.member.create({
            data: {
              tenantId,
              name,
              email,
              phone,
              companyName: company,
              status,
              notes: r.planName && !r.planId ? `Imported plan: ${r.planName} (not found)` : (r.planName ? `Imported plan: ${r.planName}` : null),
            },
          });
          imported++;
          if (email) dbEmails.add(eKey);
          dbPhones.add(phone);
          if (sendWelcomeEmail && email) {
            await sendEmail(tenantId, {
              to: email,
              subject: `Welcome to ${brand.brandName || 'Techub'}!`,
              html: `<p>Hi ${name},</p><p>Your membership at <strong>${brand.brandName || 'Techub'}</strong> is now active. We look forward to seeing you!</p><p>— The ${brand.brandName || 'Techub'} Team</p>`,
            }).catch(() => {});
            emailsQueued++;
          }
          void member;
        } catch (e) {
          errors.push({ row: r.row, message: 'create failed' });
          skipped++;
        }
      }
    }

    await writeAudit({
      tenantId, actorId, action: 'member_import.confirm', entity: 'Member',
      newValue: { imported, skipped, emailsQueued, errors: errors.length },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});

    return res.json({ imported, skipped, emailsQueued, errors });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
