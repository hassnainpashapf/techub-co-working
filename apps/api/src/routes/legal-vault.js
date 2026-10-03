// Phase 50 Track 4: Legal Document Vault — API routes.
// Mount: app.use('/api/legal-vault', require('./routes/legal-vault'));  (server.js, coordinator)
// Roles: ceo, admin, super_admin, manager. Sidebar link nahi — legal section extend hai.
//
// Endpoints:
//   GET    /                    — list (filters: category, status, expiring, search, page/limit)
//   GET    /expiring            — expiring/expired docs (dashboard widget)
//   GET    /:id                 — detail
//   POST   /                    — metadata-only create (file baad me upload)
//   POST   /upload              — multipart: file + title + category + relatedMemberId? + relatedVendorId? + expiresAt? + reminderDays?
//   PATCH  /:id                — metadata update (multipart ho to file replace)
//   GET    /:id/download        — file download (stream)
//   DELETE /:id                — doc + stored file delete
//
// Expiry reminders: apps/api/src/lib/legalVaultExpiry.js (daily job — coordinator server.js me wire kare).

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { saveFile, deleteFile, getFileStream } = require('../lib/storage');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

const LEGAL_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const LEGAL_CATEGORIES = ['contract', 'nda', 'license', 'insurance', 'other'];
const LEGAL_STATUS = ['active', 'archived'];

function hasLegalDocs() {
  return !!(prisma && prisma.legalDocument);
}

function checkRole(req, res) {
  if (!LEGAL_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: 'Not allowed' });
    return false;
  }
  return true;
}

function daysLeftOf(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function expiryStatus(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'none';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'expiring';
  return 'valid';
}

function withExpiry(doc) {
  if (!doc || !doc.expiresAt) return { ...doc, expiry: { status: 'none', daysLeft: null } };
  const daysLeft = daysLeftOf(doc.expiresAt);
  return { ...doc, expiry: { status: expiryStatus(daysLeft), daysLeft } };
}

// Executable / risky extensions — double-extension tricks bhi (har dot-segment check).
const BLOCKED_EXT = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'lnk', 'reg', 'cpl', 'msc',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'sh', 'bash', 'zsh', 'ps1', 'psm1',
  'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'war', 'apk', 'app', 'dmg',
  'pkg', 'deb', 'rpm', 'php', 'php3', 'php4', 'php5', 'phtml', 'py', 'pyc',
  'rb', 'pl', 'cgi', 'dll', 'so', 'dylib', 'sys', 'html', 'htm', 'xhtml', 'svg',
]);

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
]);

function safeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function fileChecks(file) {
  const name = safeName(file.originalname);
  const segments = name.toLowerCase().split('.').slice(1);
  if (segments.some((s) => BLOCKED_EXT.has(s))) return { ok: false, error: 'File type not allowed' };
  if (!ALLOWED_MIME.has(file.mimetype)) return { ok: false, error: `Unsupported file type: ${file.mimetype}` };
  return { ok: true, name };
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(LEGAL_CATEGORIES).default('other'),
  relatedMemberId: z.string().min(1).optional().nullable(),
  relatedVendorId: z.string().min(1).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  reminderDays: z.array(z.number().int().min(0)).max(10).optional(),
  status: z.enum(LEGAL_STATUS).default('active'),
});

// GET / — list (filters + search + pagination, expiry computed)
router.get('/', async (req, res, next) => {
  try {
    if (!checkRole(req, res)) return;
    if (!hasLegalDocs()) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    const { category, status, expiring, search, page = '1', limit = '20' } = req.query;
    const where = { ...tf };
    if (category && LEGAL_CATEGORIES.includes(category)) where.category = category;
    if (status && LEGAL_STATUS.includes(status)) where.status = status;
    if (expiring === '1') {
      where.expiresAt = { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) };
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { relatedMember: { name: { contains: search, mode: 'insensitive' } } },
        { relatedVendor: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const take = Math.min(Number(limit) || 20, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const [total, docs] = await Promise.all([
      prisma.legalDocument.count({ where }),
      prisma.legalDocument.findMany({
        where,
        include: {
          relatedMember: { select: { id: true, name: true } },
          relatedVendor: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);
    res.json({ total, page: Math.max(Number(page) || 1, 1), pages: Math.ceil(total / take), docs: docs.map(withExpiry) });
  } catch (e) { next(e); }
});

// GET /expiring — expiring (30d) + expired (dashboard widget)
router.get('/expiring', async (req, res, next) => {
  try {
    if (!checkRole(req, res)) return;
    if (!hasLegalDocs()) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    const docs = await prisma.legalDocument.findMany({
      where: {
        ...tf,
        status: 'active',
        expiresAt: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      },
      include: {
        relatedMember: { select: { id: true, name: true } },
        relatedVendor: { select: { id: true, name: true } },
      },
      orderBy: { expiresAt: 'asc' },
    });
    const withExp = docs.map(withExpiry);
    res.json({
      count: withExp.length,
      expired: withExp.filter((d) => d.expiry.status === 'expired'),
      expiring: withExp.filter((d) => d.expiry.status === 'expiring'),
    });
  } catch (e) { next(e); }
});

// GET /:id — detail
router.get('/:id', async (req, res, next) => {
  try {
    if (!checkRole(req, res)) return;
    if (!hasLegalDocs()) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    const doc = await prisma.legalDocument.findFirst({
      where: { id: req.params.id, ...tf },
      include: {
        relatedMember: { select: { id: true, name: true, email: true } },
        relatedVendor: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(withExpiry(doc));
  } catch (e) { next(e); }
});

async function verifyRelations(tf, data) {
  if (data.relatedMemberId) {
    const m = await prisma.member.findFirst({ where: { id: data.relatedMemberId, ...tf } });
    if (!m) return 'Related member not found';
  }
  if (data.relatedVendorId) {
    const v = await prisma.vendor.findFirst({ where: { id: data.relatedVendorId, ...tf } });
    if (!v) return 'Related vendor not found';
  }
  return null;
}

async function storeUploadFile(tenantId, category, file) {
  const check = fileChecks(file);
  if (!check.ok) return { error: check.error };
  const { path: storagePath } = await saveFile(file.buffer, {
    folder: `${tenantId}/legal/${category}`,
    filename: `${Date.now()}-${check.name}`,
    mimetype: file.mimetype,
  });
  return {
    fileUrl: storagePath,
    fileName: file.originalname,
    fileMime: file.mimetype,
    fileSize: file.size,
  };
}

// POST /upload — multipart upload (file + metadata)
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!checkRole(req, res)) return;
    if (!hasLegalDocs()) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const body = createSchema.parse({
      title: req.body.title,
      category: req.body.category,
      relatedMemberId: req.body.relatedMemberId || null,
      relatedVendorId: req.body.relatedVendorId || null,
      expiresAt: req.body.expiresAt || null,
      reminderDays: req.body.reminderDays ? JSON.parse(req.body.reminderDays) : undefined,
      status: req.body.status,
    });
    const relErr = await verifyRelations(tf, body);
    if (relErr) return res.status(404).json({ error: relErr });
    const stored = await storeUploadFile(tf.tenantId, body.category, req.file);
    if (stored.error) return res.status(400).json({ error: stored.error });
    const doc = await prisma.legalDocument.create({
      data: {
        ...body,
        ...stored,
        tenantId: tf.tenantId,
        createdById: req.user.id || null,
      },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id, action: 'legal_document.upload',
      entity: 'LegalDocument', entityId: doc.id, newValue: { title: doc.title, category: doc.category },
    }).catch(() => {});
    res.status(201).json(withExpiry(doc));
  } catch (e) { next(e); }
});

// POST / — metadata-only create (file baad me upload via PATCH)
router.post('/', async (req, res, next) => {
  try {
    if (!checkRole(req, res)) return;
    if (!hasLegalDocs()) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    const body = createSchema.parse(req.body);
    const relErr = await verifyRelations(tf, body);
    if (relErr) return res.status(404).json({ error: relErr });
    const doc = await prisma.legalDocument.create({
      data: { ...body, tenantId: tf.tenantId, createdById: req.user.id || null },
    });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id, action: 'legal_document.create',
      entity: 'LegalDocument', entityId: doc.id, newValue: { title: doc.title, category: doc.category },
    }).catch(() => {});
    res.status(201).json(withExpiry(doc));
  } catch (e) { next(e); }
});

// PATCH /:id — metadata update; multipart ho to file replace
router.patch('/:id', upload.single('file'), async (req, res, next) => {
  try {
    if (!checkRole(req, res)) return;
    if (!hasLegalDocs()) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    const doc = await prisma.legalDocument.findFirst({ where: { id: req.params.id, ...tf } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const raw = req.file ? { ...req.body } : req.body;
    const schema = z.object({
      title: z.string().min(1).max(200).optional(),
      category: z.enum(LEGAL_CATEGORIES).optional(),
      relatedMemberId: z.string().min(1).optional().nullable(),
      relatedVendorId: z.string().min(1).optional().nullable(),
      expiresAt: z.string().datetime().optional().nullable(),
      reminderDays: z.array(z.number().int().min(0)).max(10).optional(),
      status: z.enum(LEGAL_STATUS).optional(),
    });
    const body = schema.parse(req.file && raw.reminderDays ? { ...raw, reminderDays: JSON.parse(raw.reminderDays) } : raw);
    const relErr = await verifyRelations(tf, body);
    if (relErr) return res.status(404).json({ error: relErr });

    const data = { ...body };
    // expiresAt badla to reminder cycle reset (lastReminderKey clear)
    if (body.expiresAt !== undefined && body.expiresAt !== doc.expiresAt?.toISOString()) {
      data.lastReminderKey = null;
    }
    if (req.file) {
      const stored = await storeUploadFile(tf.tenantId, body.category || doc.category, req.file);
      if (stored.error) return res.status(400).json({ error: stored.error });
      Object.assign(data, stored);
      if (doc.fileUrl) await deleteFile(doc.fileUrl).catch(() => {});
    }
    const updated = await prisma.legalDocument.update({ where: { id: doc.id }, data });
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id, action: 'legal_document.update',
      entity: 'LegalDocument', entityId: doc.id, newValue: body,
    }).catch(() => {});
    res.json(withExpiry(updated));
  } catch (e) { next(e); }
});

// GET /:id/download — file stream
router.get('/:id/download', async (req, res, next) => {
  try {
    if (!checkRole(req, res)) return;
    if (!hasLegalDocs()) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    const doc = await prisma.legalDocument.findFirst({ where: { id: req.params.id, ...tf } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.fileUrl) return res.status(404).json({ error: 'No file attached' });
    const stream = await getFileStream(doc.fileUrl);
    res.setHeader('Content-Type', doc.fileMime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(doc.fileName || 'document').replace(/"/g, '')}"`);
    if (doc.fileSize) res.setHeader('Content-Length', String(doc.fileSize));
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (e) { next(e); }
});

// DELETE /:id — doc + stored file delete
router.delete('/:id', async (req, res, next) => {
  try {
    if (!checkRole(req, res)) return;
    if (!hasLegalDocs()) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    const doc = await prisma.legalDocument.findFirst({ where: { id: req.params.id, ...tf } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    await prisma.legalDocument.delete({ where: { id: doc.id } });
    if (doc.fileUrl) await deleteFile(doc.fileUrl).catch(() => {});
    await writeAudit({
      tenantId: tf.tenantId, actorId: req.user.id, action: 'legal_document.delete',
      entity: 'LegalDocument', entityId: doc.id, oldValue: { title: doc.title },
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
