// Phase 42 Track 9: HR Documents Vault
// Mount: app.use('/api/hr-documents', require('./routes/hr-documents'));  (server.js, coordinator)
// Roles: ceo, admin, super_admin, manager. Sidebar link nahi — employee profile ka "Documents" tab (track 1 page) se use hoga.
// HR doc types category me "hr:<type>" ke tor par store hote hain: offer_letter | contract | cnic | police_verification | other
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { saveFile } = require('../lib/storage');
const { expiryStatus, daysLeftOf } = require('../lib/docExpiryJob');
const { createNotification } = require('../lib/notify');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');

const router = express.Router();
router.use(authenticate, requireTenantUser);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const HR_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const HR_TYPES = ['offer_letter', 'contract', 'cnic', 'police_verification', 'other'];
const hrCategory = (t) => `hr:${t}`;

function hasHrDocs(prisma) {
  return !!(prisma && prisma.document);
}
function employeeWhere(req) {
  return { ...tenantFilter(req) };
}

function withExpiry(doc) {
  if (!doc || !doc.expiresAt) return { ...doc, expiry: { status: 'none', daysLeft: null } };
  const daysLeft = daysLeftOf(doc.expiresAt);
  return { ...doc, expiry: { status: expiryStatus(daysLeft), daysLeft } };
}

// Upload employee document (multipart/form-data: file, employeeId, type, expiresAt?, notes?)
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!HR_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
    if (!hasHrDocs(prisma)) return res.status(503).json({ error: 'Schema not migrated yet' });
    if (!prisma.employee) return res.status(503).json({ error: 'Schema not migrated yet' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const body = z.object({
      employeeId: z.string().min(1),
      type: z.enum(HR_TYPES),
      expiresAt: z.string().datetime().optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      title: z.string().max(200).optional().nullable(),
    }).parse(req.body);

    const tf = tenantFilter(req);
    const employee = await prisma.employee.findFirst({ where: { id: body.employeeId, ...tf } });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const { path: storagePath } = await saveFile(req.file.buffer, {
      folder: `${req.user.tenantId}/hr/${body.employeeId}`,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    });

    // Schema merge se pehle employeeId column na ho to strip karo (create na toote)
    let docData = {
      tenantId: req.user.tenantId,
      title: body.title || `${body.type} — ${employee.name}`,
      category: hrCategory(body.type),
      employeeId: body.employeeId,
      notes: body.notes || null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      storagePath,
      uploadedById: req.user.id,
      ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
    };
    try {
      const doc = await prisma.document.create({ data: docData });
      await writeAudit(req, 'hr_document.upload', 'Document', doc.id, null, { employeeId: body.employeeId, type: body.type });
      return res.status(201).json({ document: withExpiry(doc) });
    } catch (e) {
      // employee_id column merge na hua ho to us ke baghair retry
      if (e && e.code === 'P2022') {
        delete docData.employeeId;
        const doc = await prisma.document.create({ data: docData });
        await writeAudit(req, 'hr_document.upload', 'Document', doc.id, null, { employeeId: body.employeeId, type: body.type });
        return res.status(201).json({ document: withExpiry(doc) });
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors.map((x) => x.message).join(', ') });
    next(e);
  }
});

// Employee ke documents + expiry status
router.get('/employee/:employeeId', async (req, res, next) => {
  try {
    if (!HR_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
    if (!hasHrDocs(prisma)) return res.status(503).json({ error: 'Schema not migrated yet' });
    if (!prisma.employee) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    const employee = await prisma.employee.findFirst({ where: { id: req.params.employeeId, ...tf } });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    let docs = [];
    try {
      docs = await prisma.document.findMany({
        where: { ...tf, employeeId: req.params.employeeId },
        orderBy: { createdAt: 'desc' },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
    } catch (e) {
      if (e && e.code === 'P2022') {
        // column merge na hua — khaali list
        return res.json({ employee: { id: employee.id, name: employee.name }, documents: [], missing: HR_TYPES.filter((t) => t !== 'other') });
      }
      throw e;
    }
    const present = new Set(docs.map((d) => (d.category || '').replace('hr:', '')));
    const missing = ['contract', 'cnic'].filter((t) => !present.has(t));
    res.json({
      employee: { id: employee.id, name: employee.name },
      documents: docs.map(withExpiry),
      missing,
    });
  } catch (e) { next(e); }
});

// Missing documents scan: sab active employees me se jinke contract/cnic nahi — admin alert
router.post('/check-missing', async (req, res, next) => {
  try {
    if (!['ceo', 'admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
    if (!hasHrDocs(prisma)) return res.status(503).json({ error: 'Schema not migrated yet' });
    const tf = tenantFilter(req);
    if (!prisma.employee) return res.status(503).json({ error: 'Schema not migrated yet' });

    const employees = await prisma.employee.findMany({ where: { ...tf, status: 'active' }, select: { id: true, name: true } });
    let withEmployeeId = true;
    let docs = [];
    try {
      docs = await prisma.document.findMany({ where: { ...tf, category: { startsWith: 'hr:' } }, select: { employeeId: true, category: true } });
    } catch (e) {
      if (e && e.code === 'P2022') { withEmployeeId = false; }
      else throw e;
    }
    const byEmp = {};
    if (withEmployeeId) {
      for (const d of docs) {
        if (!d.employeeId) continue;
        byEmp[d.employeeId] = byEmp[d.employeeId] || new Set();
        byEmp[d.employeeId].add((d.category || '').replace('hr:', ''));
      }
    }
    const missing = employees
      .map((e) => {
        const has = byEmp[e.id] || new Set();
        const miss = ['contract', 'cnic'].filter((t) => !has.has(t));
        return miss.length ? { employeeId: e.id, name: e.name, missing: miss } : null;
      })
      .filter(Boolean);

    if (missing.length) {
      try {
        await createNotification(prisma, {
          tenantId: req.user.tenantId,
          role: 'admin',
          type: 'hr.docs_missing',
          message: `${missing.length} employee(s) ke HR documents missing hain (contract/CNIC)`,
        });
      } catch {}
    }
    await writeAudit(req, 'hr_document.check_missing', 'Employee', null, null, { count: missing.length });
    res.json({ missing, count: missing.length });
  } catch (e) { next(e); }
});

module.exports = router;
