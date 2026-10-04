// Phase 53 Track 4: Certificate issuance + HMAC verify codes + PDF.
// dayPassQr.js wala pattern: base64url(payload) + "." + base64url(HMAC-SHA256(payload))
// Payload: { v: 1, tenantId, courseId, memberId, enrollmentId, issuedAt }
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const CERT_VERSION = 1;

function certSecret() {
  return process.env.JWT_ACCESS_SECRET || '';
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signCertificateCode({ tenantId, courseId, memberId, enrollmentId, issuedAt }) {
  const payload = {
    v: CERT_VERSION,
    tenantId,
    courseId,
    memberId,
    enrollmentId,
    issuedAt: new Date(issuedAt).getTime(),
  };
  const body = b64urlEncode(payload);
  const sig = crypto.createHmac('sha256', certSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Asal tasdeeq: HMAC verify + DB lookup (caller DB check karta hai).
function verifyCertificateCode(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', certSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.v !== CERT_VERSION) return { ok: false, reason: 'bad-version' };
  return { ok: true, payload };
}

// Models parallel tracks (1: courses, 2: enrollments, 3: quizzes) me bante hain —
// defensive access taake koi model abhi missing ho to crash na ho.
function hasModel(prisma, name) {
  try {
    return typeof prisma?.[name]?.findFirst === 'function';
  } catch {
    return false;
  }
}

/**
 * issueCertificate(enrollmentId, { tenantId })
 * Rules: course ke tamam lessons completed + tamam course quizzes passed
 * honi chahiyen. Ek enrollment par ek hi certificate (idempotent).
 */
async function issueCertificate(prisma, enrollmentId, { tenantId }) {
  if (!hasModel(prisma, 'enrollment')) {
    throw new Error('Enrollment model abhi available nahi (Track 2 merge baqi)');
  }
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, tenantId },
    include: {
      ...(hasModel(prisma, 'course') ? { course: true } : {}),
      ...(hasModel(prisma, 'member') ? { member: true } : {}),
    },
  });
  if (!enrollment) {
    const err = new Error('Enrollment nahi mili');
    err.status = 404;
    throw err;
  }

  const courseId = enrollment.courseId || enrollment.course?.id;
  const memberId = enrollment.memberId || enrollment.member?.id;

  // Pehle se issued?
  const existing = await prisma.certificate.findFirst({
    where: { tenantId, courseId, memberId },
  });
  if (existing) return { certificate: existing, alreadyIssued: true };

  // --- Completion check ---
  let complete = false;
  if (String(enrollment.status || '').toLowerCase() === 'completed') {
    complete = true;
  } else if (hasModel(prisma, 'lesson') && hasModel(prisma, 'lessonProgress')) {
    const lessons = await prisma.lesson.findMany({ where: { tenantId, courseId } });
    if (lessons.length > 0) {
      const done = await prisma.lessonProgress.count({
        where: { tenantId, enrollmentId, completed: true },
      });
      complete = done >= lessons.length;
    } else {
      complete = true; // lesson-less course: sirf quiz check
    }
  }
  if (!complete) {
    const err = new Error('Course abhi complete nahi — pehle tamam lessons mukammal karein');
    err.status = 422;
    throw err;
  }

  // --- Quiz check: tamam course quizzes me passing attempt lazmi ---
  if (hasModel(prisma, 'quiz') && hasModel(prisma, 'quizAttempt')) {
    const quizzes = await prisma.quiz.findMany({ where: { tenantId, courseId } });
    for (const quiz of quizzes) {
      const attempt = await prisma.quizAttempt.findFirst({
        where: { tenantId, quizId: quiz.id, enrollmentId, passed: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!attempt) {
        const err = new Error(`Quiz "${quiz.title || quiz.id}" me pass karna lazmi hai`);
        err.status = 422;
        throw err;
      }
    }
  }

  const issuedAt = new Date();
  const code = signCertificateCode({
    tenantId,
    courseId,
    memberId,
    enrollmentId,
    issuedAt,
  });

  const certificate = await prisma.certificate.create({
    data: {
      tenantId,
      courseId,
      memberId,
      code,
      issuedAt,
    },
  });
  const pdfUrl = `/api/certificates/${certificate.id}/pdf`;
  await prisma.certificate.update({ where: { id: certificate.id }, data: { pdfUrl } });

  return { certificate: { ...certificate, pdfUrl }, alreadyIssued: false };
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

/**
 * generateCertificatePdf(certificate) → Buffer
 * certificate: full record with member + course + tenant
 */
function generateCertificatePdf(certificate) {
  return (() => {
    const doc = new PDFDocument({ margin: 60, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const bufPromise = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const member = certificate.member || {};
    const course = certificate.course || {};
    const tenant = certificate.tenant || {};
    const W = doc.page.width - 120;
    const CX = 60;

    // Border
    doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(3).stroke('#1e3a8a');
    doc.rect(40, 40, doc.page.width - 80, doc.page.height - 80).lineWidth(1).stroke('#93c5fd');

    // Org
    doc.fontSize(14).font('Helvetica').fillColor('#64748b').text(tenant.name || 'Coworking Academy', CX, 90, { width: W, align: 'center' });

    // Title
    doc.fontSize(38).font('Helvetica-Bold').fillColor('#1e3a8a').text('Certificate of Completion', CX, 130, { width: W, align: 'center' });

    // Awarded to
    doc.moveDown(1.2);
    doc.fontSize(12).font('Helvetica').fillColor('#64748b').text('This certificate is proudly presented to', CX, doc.y, { width: W, align: 'center' });
    doc.fontSize(30).font('Helvetica-Bold').fillColor('#0f172a').text(member.name || '—', CX, doc.y + 8, { width: W, align: 'center' });

    // Course
    doc.fontSize(12).font('Helvetica').fillColor('#64748b').text('for successfully completing the course', CX, doc.y + 10, { width: W, align: 'center' });
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1e3a8a').text(course.title || course.name || '—', CX, doc.y + 8, { width: W, align: 'center' });

    // Date + code
    doc.fontSize(11).font('Helvetica').fillColor('#475569').text(`Issued on ${fmtDate(certificate.issuedAt)}`, CX, doc.y + 16, { width: W, align: 'center' });
    const verifyUrl = `${process.env.FRONTEND_URL || 'https://techub-co-working.pages.dev'}/academy/verify/${certificate.code}`;
    doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Verify: ${verifyUrl}`, CX, doc.y + 6, { width: W, align: 'center' });
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#334155').text(`Code: ${certificate.code}`, CX, doc.y + 6, { width: W, align: 'center' });

    doc.end();
    return bufPromise;
  })();
}

module.exports = {
  signCertificateCode,
  verifyCertificateCode,
  issueCertificate,
  generateCertificatePdf,
};
