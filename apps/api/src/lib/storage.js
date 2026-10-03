// File storage abstraction.
// Local disk for now; swap `saveBuffer`/`readStream`/`remove` with S3 SDK calls later.
// Env overrides: UPLOAD_DIR (default ./uploads), MAX_UPLOAD_MB (default 25).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

function ensureDir(tenantId) {
  const dir = path.join(UPLOAD_DIR, tenantId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function storageKey(tenantId, originalName) {
  const ext = path.extname(originalName || '').slice(0, 12);
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

function saveFile(tenantId, file) {
  // file: multer file object { originalname, mimetype, size, buffer }
  if (!ALLOWED_MIME.has(file.mimetype)) {
    const err = new Error(`File type not allowed: ${file.mimetype}`);
    err.status = 400;
    throw err;
  }
  if (file.size > MAX_BYTES) {
    const err = new Error(`File too large (max ${MAX_BYTES / 1024 / 1024}MB)`);
    err.status = 400;
    throw err;
  }
  const dir = ensureDir(tenantId);
  const key = storageKey(tenantId, file.originalname);
  const fullPath = path.join(dir, key);
  fs.writeFileSync(fullPath, file.buffer);
  return { storagePath: fullPath, key };
}

function readStream(storagePath) {
  return fs.createReadStream(storagePath);
}

function fileExists(storagePath) {
  return storagePath && fs.existsSync(storagePath);
}

function removeFile(storagePath) {
  try {
    if (storagePath && fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
  } catch { /* ignore */ }
}

module.exports = { saveFile, readStream, fileExists, removeFile, MAX_BYTES, UPLOAD_DIR };
