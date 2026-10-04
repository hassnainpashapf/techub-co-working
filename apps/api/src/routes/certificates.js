// Phase 53 Track 4: Certificates API.
// Mount (coordinator): app.use('/api/certificates', require('./routes/certificates'));
// Public: GET /verify/:code (login nahi chahiye — asal tasdeeq).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { emitWebhook } = require('../lib/webhooks');
const {
  issueCertificate,
  verifyCertificateCode,
  generateCertificatePdf,
} = require('../lib/certificates');

const router = express.Router();

// ---------------- PUBLIC: verify by code ----------------
router.get('/verify/:code', async (req, res) => {
  const check = verifyCertificateCode(req.params.code);
  if (!check.ok) {
    return res.status(400).json({ ok: false, valid: false, reason: check.reason });
  }
  const cert = await prisma.certificate.findUnique({
    where: { code: req.params.code },
    include: {
      member: { select: { id: true, name: true } },
      course: { select: { id: true, title: true } },
      tenant: { select: { id: true, name: true } },
    },
  });
  if (!cert) return res.status(404).json({ ok: false, valid: false, reason: 'not-found' });
  // Double-check: code me likha tenantId DB record se match kare
  if (check.payload.tenantId !== cert.tenantId) {
    return res.status(400).json({ ok: false, valid: false, reason: 'tenant-mismatch' });
  }
  return res.json({
    ok: true,
    valid: true,
    certificate: {
      id: cert.id,
      code: cert.code,
      memberName: cert.member?.name,
      courseTitle: cert.course?.title,
      organization: cert.tenant?.name,
      issuedAt: cert.issuedAt,
    },
  });
});

// ---------------- Authenticated routes ----------------
router.use(authenticate, requireTenantUser);

const STAFF = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];
const staffOnly = requireRole(...STAFF);

// GET /api/certificates — member apne, staff sab (filters ke sath)
router.get('/', async (req, res) => {
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.user.role === 'member' && req.user.memberId) {
    where.memberId = req.user.memberId;
  } else {
    if (req.query.memberId) where.memberId = String(req.query.memberId);
    if (req.query.courseId) where.courseId = String(req.query.courseId);
  }
  const certs = await prisma.certificate.findMany({
    where,
    include: {
      member: { select: { id: true, name: true } },
      course: { select: { id: true, title: true } },
    },
    orderBy: { issuedAt: 'desc' },
  });
  res.json({ ok: true, certificates: certs });
});

// POST /api/certificates/issue — staff ya khud member (apni enrollment par)
const issueSchema = z.object({ enrollmentId: z.string().min(1) });
router.post('/issue', async (req, res) => {
  const { enrollmentId } = issueSchema.parse(req.body);
  const tf = tenantFilter(req);
  // Member sirf apni enrollment par issue kar sakta hai
  if (req.user.role === 'member' && req.user.memberId) {
    const enr = await prisma.enrollment.findFirst({
      where: { id: enrollmentId, ...tf, memberId: req.user.memberId },
    });
    if (!enr) return res.status(404).json({ ok: false, error: 'Enrollment nahi mili' });
  }
  try {
    const { certificate, alreadyIssued } = await issueCertificate(prisma, enrollmentId, tf);
    await writeAudit(req, {
      action: alreadyIssued ? 'certificate.reissued' : 'certificate.issued',
      entity: 'Certificate',
      entityId: certificate.id,
      meta: { enrollmentId, code: certificate.code },
    }).catch(() => {});
    emitWebhook(tf.tenantId, 'certificate.issued', { certificateId: certificate.id, code: certificate.code }).catch(() => {});
    res.status(alreadyIssued ? 200 : 201).json({ ok: true, certificate, alreadyIssued });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Issue nakaam' });
  }
});

// GET /api/certificates/:id/pdf — download (member apna, staff koi bhi)
router.get('/:id/pdf', async (req, res) => {
  const tf = tenantFilter(req);
  const where = { id: req.params.id, ...tf };
  if (req.user.role === 'member' && req.user.memberId) where.memberId = req.user.memberId;
  const cert = await prisma.certificate.findFirst({
    where,
    include: { member: true, course: true, tenant: true },
  });
  if (!cert) return res.status(404).json({ ok: false, error: 'Certificate nahi mila' });
  const pdf = await generateCertificatePdf(cert);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.code.slice(0, 12)}.pdf"`);
  res.send(pdf);
});

module.exports = router;
