const express = require('express');
const { z } = require('zod');
const multer = require('multer');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { saveFile, getFileStream, fileExists, deleteFile, MAX_BYTES } = require('../lib/storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

const router = express.Router();

router.use(authenticate, requireTenantUser);

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const write = requireRole(...WRITE_ROLES);
const FINANCE_ROLES = ['ceo', 'admin', 'finance_officer'];
const financeWrite = requireRole(...FINANCE_ROLES);

// --------------------------------------------------------------- documents ---
const docSchema = z.object({
  title: z.string().min(1),
  category: z.string().default('general'),
  memberId: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  fileSize: z.number().int().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Phase 38 Track 7: expiry tracking (optional)
  issuedAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  reminderDays: z.array(z.number().int().min(0)).optional().nullable(),
});

const expirySchema = z.object({
  issuedAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  reminderDays: z.array(z.number().int().min(0)).optional().nullable(),
});

// Phase 38 Track 7: expiry columns migrate na hue hon to 503.
async function expiryReady() {
  try {
    await prisma.document.findFirst({ select: { expiresAt: true } });
    return true;
  } catch {
    return false;
  }
}

function expiryOf(doc) {
  if (!doc || !doc.expiresAt) return { expiryStatus: 'none', daysLeft: null };
  const daysLeft = Math.ceil((new Date(doc.expiresAt).getTime() - Date.now()) / 86400000);
  const expiryStatus = daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'valid';
  return { expiryStatus, daysLeft };
}

function withExpiry(doc) {
  return { ...doc, ...expiryOf(doc) };
}

router.get('/documents', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.user.role === 'member' && req.user.memberId) where.memberId = req.user.memberId;
    else if (req.query.memberId) where.memberId = String(req.query.memberId);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.search) where.title = { contains: String(req.query.search), mode: 'insensitive' };
    const documents = await prisma.document.findMany({
      where,
      include: {
        member: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents: documents.map(withExpiry) });
  } catch (e) { next(e); }
});

// Phase 38 Track 7: expiring documents (default 30 din me expire hone wale)
router.get('/documents/expiring', async (req, res, next) => {
  try {
    if (!(await expiryReady())) {
      return res.status(503).json({ error: 'Expiry tracking not migrated yet' });
    }
    const days = Math.max(1, parseInt(req.query.days, 10) || 30);
    const cutoff = new Date(Date.now() + days * 86400000);
    const where = {
      ...tenantFilter(req),
      expiresAt: { not: null, lte: cutoff },
    };
    if (req.user.role === 'member' && req.user.memberId) where.memberId = req.user.memberId;
    else if (req.query.memberId) where.memberId = String(req.query.memberId);
    if (req.query.status === 'expired') where.expiresAt = { lt: new Date() };
    const documents = await prisma.document.findMany({
      where,
      include: { member: { select: { id: true, name: true } } },
      orderBy: { expiresAt: 'asc' },
    });
    res.json({ documents: documents.map(withExpiry), count: documents.length });
  } catch (e) { next(e); }
});

// Phase 38 Track 7: expiry set/update karo
router.put('/documents/:id/expiry', write, validateBody(expirySchema), async (req, res, next) => {
  try {
    if (!(await expiryReady())) {
      return res.status(503).json({ error: 'Expiry tracking not migrated yet' });
    }
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const data = {};
    if (req.body.issuedAt !== undefined) data.issuedAt = req.body.issuedAt ? new Date(req.body.issuedAt) : null;
    if (req.body.expiresAt !== undefined) data.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    if (req.body.reminderDays !== undefined) data.reminderDays = req.body.reminderDays;
    // expiresAt badla to reminder cycle reset (nayi key base)
    if (req.body.expiresAt !== undefined) data.lastReminderKey = null;
    const updated = await prisma.document.update({ where: { id: doc.id }, data });
    await writeAudit(req, 'document.expiry_update', 'Document', doc.id, null, {
      expiresAt: updated.expiresAt,
      reminderDays: updated.reminderDays,
    });
    res.json({ document: withExpiry(updated) });
  } catch (e) { next(e); }
});

router.post('/documents', write, validateBody(docSchema), async (req, res, next) => {
  try {
    const data = { ...req.body, tenantId: req.user.tenantId, uploadedById: req.user.id };
    if (data.issuedAt) data.issuedAt = new Date(data.issuedAt);
    if (data.expiresAt) data.expiresAt = new Date(data.expiresAt);
    const doc = await prisma.document.create({
      data,
      include: { member: { select: { id: true, name: true } } },
    });
    await writeAudit(req, 'document.create', 'Document', doc.id, null, { title: doc.title });
    res.status(201).json({ document: doc });
  } catch (e) { next(e); }
});

router.delete('/documents/:id', write, async (req, res, next) => {
  try {
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, ...tenantFilter(req) } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    await prisma.document.delete({ where: { id: req.params.id } });
    if (doc.storagePath) await deleteFile(doc.storagePath);
    await writeAudit(req, 'document.delete', 'Document', doc.id, { title: doc.title }, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Upload a real file + create document record (multipart/form-data)
router.post('/documents/upload', write, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { title, category, memberId, notes, issuedAt, expiresAt, reminderDays } = req.body;
    if (memberId) {
      const member = await prisma.member.findFirst({ where: { id: memberId, ...tenantFilter(req) } });
      if (!member) return res.status(400).json({ error: 'Member not found' });
    }
    const { path: storagePath } = await saveFile(req.file.buffer, {
      folder: req.user.tenantId,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    let parsedReminders;
    try {
      parsedReminders = reminderDays ? JSON.parse(reminderDays) : undefined;
    } catch { parsedReminders = undefined; }
    const doc = await prisma.document.create({
      data: {
        tenantId: req.user.tenantId,
        title: title || req.file.originalname,
        category: category || 'general',
        memberId: memberId || null,
        notes: notes || null,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        storagePath,
        uploadedById: req.user.id,
        // Phase 38 Track 7: expiry (columns migrate na hue hon to ignore)
        ...(issuedAt ? { issuedAt: new Date(issuedAt) } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
        ...(Array.isArray(parsedReminders) ? { reminderDays: parsedReminders } : {}),
      },
      include: { member: { select: { id: true, name: true } } },
    });
    await writeAudit(req, 'document.upload', 'Document', doc.id, null, { title: doc.title, size: doc.fileSize });
    res.status(201).json({ document: doc });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    next(e);
  }
});

// Download a document file (auth + tenant checked)
router.get('/documents/:id/download', async (req, res, next) => {
  try {
    const where = { id: req.params.id, ...tenantFilter(req) };
    if (req.user.role === 'member' && req.user.memberId) where.memberId = req.user.memberId;
    const doc = await prisma.document.findFirst({ where });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.storagePath || !(await fileExists(doc.storagePath))) {
      return res.status(404).json({ error: 'File not available' });
    }
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${(doc.fileName || 'file').replace(/"/g, '')}"`);
    if (doc.fileSize) res.setHeader('Content-Length', doc.fileSize);
    (await getFileStream(doc.storagePath)).pipe(res);
  } catch (e) { next(e); }
});

// ------------------------------------------------------------ credit notes ---
const cnSchema = z.object({
  memberId: z.string().min(1),
  invoiceId: z.string().optional().nullable(),
  amount: z.number().positive(),
  reason: z.string().optional().nullable(),
});

async function nextCnNumber(tenantId) {
  const now = new Date();
  const prefix = `CN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const last = await prisma.creditNote.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const seq = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

router.get('/credit-notes', async (req, res, next) => {
  try {
    const where = { ...tenantFilter(req) };
    if (req.user.role === 'member' && req.user.memberId) where.memberId = req.user.memberId;
    else if (req.query.memberId) where.memberId = String(req.query.memberId);
    if (req.query.status) where.status = String(req.query.status);
    const notes = await prisma.creditNote.findMany({
      where,
      include: {
        member: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ creditNotes: notes });
  } catch (e) { next(e); }
});

router.post('/credit-notes', financeWrite, validateBody(cnSchema), async (req, res, next) => {
  try {
    const member = await prisma.member.findFirst({
      where: { id: req.body.memberId, ...tenantFilter(req) },
    });
    if (!member) return res.status(400).json({ error: 'Member not found' });
    const cn = await prisma.creditNote.create({
      data: {
        ...req.body,
        tenantId: req.user.tenantId,
        number: await nextCnNumber(req.user.tenantId),
        createdById: req.user.id,
      },
      include: { member: { select: { id: true, name: true } } },
    });
    await writeAudit(req, 'creditnote.create', 'CreditNote', cn.id, null, { number: cn.number });
    res.status(201).json({ creditNote: cn });
  } catch (e) { next(e); }
});

// Apply credit note to an invoice
router.post('/credit-notes/:id/apply', financeWrite, validateBody(z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
})), async (req, res, next) => {
  try {
    const cn = await prisma.creditNote.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!cn) return res.status(404).json({ error: 'Credit note not found' });
    if (cn.status !== 'open') return res.status(400).json({ error: 'Credit note is not open' });
    const available = Number(cn.amount) - Number(cn.amountUsed);
    if (req.body.amount > available) return res.status(400).json({ error: 'Amount exceeds available credit' });

    const invoice = await prisma.invoice.findFirst({
      where: { id: req.body.invoiceId, ...tenantFilter(req) },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const newUsed = Number(cn.amountUsed) + req.body.amount;
    const newPaid = Number(invoice.amountPaid) + req.body.amount;
    const newStatus = newPaid >= Number(invoice.amount) ? 'paid' : newPaid > 0 ? 'partial' : invoice.status;

    await prisma.$transaction([
      prisma.creditNote.update({
        where: { id: cn.id },
        data: {
          amountUsed: newUsed,
          status: newUsed >= Number(cn.amount) ? 'applied' : 'open',
        },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid: newPaid, status: newStatus },
      }),
      prisma.payment.create({
        data: {
          tenantId: req.user.tenantId,
          invoiceId: invoice.id,
          memberId: invoice.memberId,
          amount: req.body.amount,
          method: 'credit_note',
          note: `Applied ${cn.number}`,
          paidAt: new Date(),
        },
      }),
    ]);
    res.json({ ok: true, applied: req.body.amount });
  } catch (e) { next(e); }
});

router.post('/credit-notes/:id/cancel', financeWrite, async (req, res, next) => {
  try {
    const cn = await prisma.creditNote.findFirst({
      where: { id: req.params.id, ...tenantFilter(req) },
    });
    if (!cn) return res.status(404).json({ error: 'Credit note not found' });
    if (Number(cn.amountUsed) > 0) return res.status(400).json({ error: 'Cannot cancel: credit already used' });
    await prisma.creditNote.update({ where: { id: cn.id }, data: { status: 'cancelled' } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
