// Phase 47 Track 4/10: Form File Uploads
// Mount: app.use('/api/form-uploads', require('./routes/form-uploads'));  (server.js, coordinator)
// Public route — NO auth. Rate-limited. Sirf PUBLISHED forms ke file fields ke liye.
//
// Flow:
//   1. Public form page: POST / (multipart: file + slug + fieldId) -> { token, fileName, size, mimetype }
//   2. Form submit (Track 2, routes/form-public.js): answers me file field ki value = token.
//      Submit handler submit se PEHLE verifyUploadToken(token) call kare — signature galat ho to 400.
//      (Integration snippet is file ke bottom me hai.)
//   3. Download: GET /download?token= — HMAC-signed capability URL, token unguessable hai.
//
// Token format: base64url(payload).base64url(hmac_sha256(secret, payload))
// payload = { p: storagePath, fn: fileName, sz: size, mt: mimetype, t: uploadedAt }
// Koi migration nahi — answers Json me token store hota hai (Track 2 ka FormSubmission).
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { saveFile, getFileStream } = require('../lib/storage');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Public upload — 10 uploads/min per IP (abuse guard)
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many uploads. Try again in a minute.' });
router.use(uploadLimiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const UPLOAD_SECRET = () => process.env.FORM_UPLOAD_SECRET || process.env.JWT_SECRET || 'form-upload-dev-secret';
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 din

// Executable / risky extensions — filename ke HAR dot-segment par check hota hai
// taake "photo.jpg.exe" jaisi double-extension tricks bhi pakri jayein.
const BLOCKED_EXT = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'lnk', 'reg', 'cpl', 'msc',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'hta',
  'jar', 'war', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm',
  'php', 'php3', 'php4', 'php5', 'phtml', 'py', 'pyc', 'rb', 'pl', 'cgi',
  'dll', 'so', 'dylib', 'sys',
  'html', 'htm', 'xhtml', 'svg', // XSS risk (script embed ho sakta hai)
]);

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
]);

function hasCustomForm(prisma) {
  return !!(prisma && prisma.customForm);
}

function extSegments(filename) {
  return String(filename || '').split('.').slice(1).map((s) => s.toLowerCase());
}

function validateFile(file, field) {
  if (!file) return 'No file uploaded';
  const segs = extSegments(file.originalname);
  if (segs.some((s) => BLOCKED_EXT.has(s))) {
    return 'File type not allowed';
  }
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return `File type not allowed (${file.mimetype || 'unknown'})`;
  }
  const maxMb = Number(field && field.maxSizeMb) || 10;
  if (file.size > maxMb * 1024 * 1024) {
    return `File too large (max ${maxMb}MB)`;
  }
  return null;
}

function b64uEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function b64uDecode(s) {
  return JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));
}

function signUpload(payload) {
  const body = b64uEncode(payload);
  const sig = crypto.createHmac('sha256', UPLOAD_SECRET()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Track 2 (form-public.js submit) isay use karega — token answers me aane se pehle verify.
function verifyUploadToken(token) {
  try {
    if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };
    const [body, sig] = token.split('.');
    if (!body || !sig) return { ok: false, reason: 'malformed' };
    const expected = crypto.createHmac('sha256', UPLOAD_SECRET()).update(body).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { ok: false, reason: 'bad-signature' };
    }
    const payload = b64uDecode(body);
    if (!payload || typeof payload.p !== 'string' || !payload.p) return { ok: false, reason: 'malformed' };
    if (payload.t && Date.now() - payload.t > TOKEN_TTL_MS) return { ok: false, reason: 'expired' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

// POST / — public file upload for a published form's file field.
// multipart/form-data: file, slug, fieldId
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10MB)' });
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unexpected file field' });
      return next(err);
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!hasCustomForm(prisma)) return res.status(503).json({ error: 'Schema not migrated yet' });
    const body = z.object({
      slug: z.string().min(1).max(120),
      fieldId: z.string().min(1).max(80),
    }).safeParse(req.body || {});
    if (!body.success) return res.status(400).json({ error: 'slug and fieldId are required' });

    const form = await prisma.customForm.findFirst({
      where: { slug: body.data.slug, status: 'published' },
      select: { id: true, tenantId: true, slug: true, fields: true, status: true },
    });
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const fields = Array.isArray(form.fields) ? form.fields : [];
    const field = fields.find((f) => f && f.id === body.data.fieldId && f.type === 'file');
    if (!field) return res.status(400).json({ error: 'Invalid file field' });

    const fileErr = validateFile(req.file, field);
    if (fileErr) return res.status(400).json({ error: fileErr });

    const safeName = String(req.file.originalname).replace(/[^\w.\-() ]+/g, '_').slice(0, 120) || 'upload';
    const { path: storagePath } = await saveFile(req.file.buffer, {
      folder: `${form.tenantId}/forms/${form.slug}`,
      filename: `${Date.now()}-${safeName}`,
      mimetype: req.file.mimetype,
    });

    const token = signUpload({
      p: storagePath,
      fn: req.file.originalname,
      sz: req.file.size,
      mt: req.file.mimetype,
      t: Date.now(),
    });

    return res.status(201).json({
      token,
      fileName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (e) {
    next(e);
  }
});

// GET /download?token= — capability URL (token HMAC-signed, unguessable).
router.get('/download', async (req, res, next) => {
  try {
    const v = verifyUploadToken(req.query.token);
    if (!v.ok) return res.status(400).json({ error: `Invalid token (${v.reason})` });
    const { p, fn, mt, sz } = v.payload;
    const stream = await getFileStream(p);
    res.setHeader('Content-Type', mt || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(fn || 'file').replace(/"/g, '')}"`);
    if (sz) res.setHeader('Content-Length', String(sz));
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.verifyUploadToken = verifyUploadToken;
module.exports.signUpload = signUpload;

/* ---------------------------------------------------------------------------
 * TRACK 2 INTEGRATION (routes/form-public.js — POST /:slug/submit me):
 *
 *   const { verifyUploadToken } = require('./form-uploads');
 *
 *   // answers validate karte waqt, har file-type field ki value ke liye:
 *   for (const f of fields.filter(f => f.type === 'file')) {
 *     const token = answers[f.id];
 *     if (f.required && !token) return res.status(400).json({ error: `${f.label} required` });
 *     if (token) {
 *       const v = verifyUploadToken(token);
 *       if (!v.ok) return res.status(400).json({ error: `Invalid upload for ${f.label}` });
 *       // optional: answers[f.id] ko normalized object me badlo:
 *       // answers[f.id] = { token, fileName: v.payload.fn, size: v.payload.sz, mimetype: v.payload.mt,
 *       //                  downloadUrl: `/api/form-uploads/download?token=${token}` };
 *     }
 *   }
 *
 * FRONTEND (public form renderer — Track 2):
 *   file field par: pehle POST /api/form-uploads (FormData: file, slug, fieldId)
 *   -> { token } mile to usay answers[fieldId] me rakho, phir submit karo.
 *   Upload progress + "uploading..." state dikhana.
 * ------------------------------------------------------------------------- */
