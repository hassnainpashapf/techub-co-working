// Phase 29 Track 1: Storage abstraction — S3-compatible (SigV4, no new deps)
// with local-disk fallback. Same interface in both modes.
//
// New interface:
//   saveFile(buffer, { folder, filename, mimetype, allowedMime? }) -> Promise<{ path, url, key }>
//   deleteFile(path) -> Promise<void>
//   getFileStream(path) -> Promise<Readable>
//   getProvider() -> 's3' | 'local'
//   isS3Configured() -> bool
//   fileExists(path) -> Promise<bool>
//
// Backwards-compat (server.js is untouched by this track, so these keep
// working exactly as before for local paths):
//   readStream(path) -> Readable (sync; s3:// paths lazy-fetch via PassThrough)
//   removeFile(path) -> fire-and-forget delete
//   MAX_BYTES, UPLOAD_DIR
//
// Path format: local mode -> absolute fs path (backwards compatible with
// existing DB rows); s3 mode -> "s3://bucket/key". deleteFile/getFileStream/
// fileExists detect the scheme automatically.
//
// Env: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET,
//      S3_REGION (default us-east-1), S3_PUBLIC_URL (optional, for public urls),
//      UPLOAD_DIR (default ./uploads), MAX_UPLOAD_MB (default 25).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, PassThrough } = require('stream');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024;

const DEFAULT_ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

function isS3Configured() {
  return !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET);
}

function getProvider() {
  return isS3Configured() ? 's3' : 'local';
}

function s3Region() {
  return process.env.S3_REGION || 'us-east-1';
}

function s3Base() {
  return String(process.env.S3_ENDPOINT).replace(/\/+$/, '');
}

function s3Bucket() {
  return process.env.S3_BUCKET;
}

// Encode each path segment per S3 SigV4 rules (keep '/' separators).
function encodeS3Uri(p) {
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

function parseS3Path(p) {
  // "s3://bucket/key" -> { bucket, key }
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(p || '');
  return m ? { bucket: m[1], key: m[2] } : null;
}

// ---------------------------------------------------------------- SigV4 ---
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function s3Fetch(method, key, { body, contentType } = {}) {
  const region = s3Region();
  const bucket = s3Bucket();
  const url = `${s3Base()}/${bucket}/${encodeS3Uri(key)}`;
  const urlObj = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body || '');

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = `host:${urlObj.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    method,
    urlObj.pathname,
    urlObj.search ? urlObj.search.slice(1) : '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [algorithm, amzDate, credentialScope, sha256hex(canonicalRequest)].join('\n');

  const kSigning = hmac(hmac(hmac(hmac('AWS4' + process.env.S3_SECRET_KEY, dateStamp), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization =
    `${algorithm} Credential=${process.env.S3_ACCESS_KEY}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    Authorization: authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  if (contentType) headers['Content-Type'] = contentType;

  return fetch(url, { method, headers, body: body || undefined });
}

// -------------------------------------------------------------- interface ---
function storageKey(folder, filename) {
  const ext = path.extname(filename || '').slice(0, 12);
  const safeFolder = String(folder || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
  const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  return { safeFolder, key, fullKey: `${safeFolder}/${key}` };
}

function checkFile(buffer, mimetype, allowedMime) {
  const allowed = allowedMime ? new Set(allowedMime) : DEFAULT_ALLOWED_MIME;
  if (!allowed.has(mimetype)) {
    const err = new Error(`File type not allowed: ${mimetype}`);
    err.status = 400;
    throw err;
  }
  if (!buffer || buffer.length === 0) {
    const err = new Error('Empty file');
    err.status = 400;
    throw err;
  }
  if (buffer.length > MAX_BYTES) {
    const err = new Error(`File too large (max ${MAX_BYTES / 1024 / 1024}MB)`);
    err.status = 400;
    throw err;
  }
}

async function saveFile(buffer, { folder, filename, mimetype, allowedMime } = {}) {
  checkFile(buffer, mimetype, allowedMime);
  const { safeFolder, key, fullKey } = storageKey(folder, filename);

  if (getProvider() === 's3') {
    const res = await s3Fetch('PUT', fullKey, { body: buffer, contentType: mimetype });
    if (!res.ok) {
      const err = new Error(`S3 upload failed (${res.status})`);
      err.status = 502;
      throw err;
    }
    const publicBase = (process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '');
    return {
      path: `s3://${s3Bucket()}/${fullKey}`,
      url: publicBase ? `${publicBase}/${s3Bucket()}/${fullKey}` : null,
      key,
    };
  }

  const dir = path.join(UPLOAD_DIR, safeFolder);
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, key);
  fs.writeFileSync(fullPath, buffer);
  return { path: fullPath, url: null, key };
}

async function deleteFile(filePath) {
  if (!filePath) return;
  const s3 = parseS3Path(filePath);
  if (s3) {
    if (!isS3Configured()) return;
    try { await s3Fetch('DELETE', s3.key); } catch { /* ignore */ }
    return;
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }
}

async function getFileStream(filePath) {
  const s3 = parseS3Path(filePath);
  if (s3) {
    const res = await s3Fetch('GET', s3.key);
    if (!res.ok || !res.body) {
      const err = new Error(`S3 download failed (${res.status})`);
      err.status = res.status === 404 ? 404 : 502;
      throw err;
    }
    return Readable.fromWeb(res.body);
  }
  return fs.createReadStream(filePath);
}

async function fileExists(filePath) {
  if (!filePath) return false;
  const s3 = parseS3Path(filePath);
  if (s3) {
    if (!isS3Configured()) return false;
    try {
      const res = await s3Fetch('HEAD', s3.key);
      return res.ok;
    } catch { return false; }
  }
  return fs.existsSync(filePath);
}

// Sync variant for legacy callers (server.js logo route). Local paths are
// checked for real; s3:// paths are assumed present when S3 is configured
// (readStream below surfaces a stream error if the object is actually gone).
function fileExistsSync(filePath) {
  if (!filePath) return false;
  if (parseS3Path(filePath)) return isS3Configured();
  return fs.existsSync(filePath);
}

// Sync readStream for legacy callers: local -> fs stream; s3:// -> lazy
// PassThrough that resolves the S3 fetch asynchronously.
function readStream(filePath) {
  const s3 = parseS3Path(filePath);
  if (!s3) return fs.createReadStream(filePath);
  const out = new PassThrough();
  getFileStream(filePath).then(
    (s) => s.pipe(out),
    (err) => out.destroy(err)
  );
  return out;
}

function removeFile(filePath) {
  deleteFile(filePath).catch(() => {});
}

module.exports = {
  // New interface
  saveFile,
  deleteFile,
  getFileStream,
  getProvider,
  isS3Configured,
  fileExists,
  fileExistsSync,
  // Backwards-compat aliases (server.js untouched)
  readStream,
  removeFile,
  MAX_BYTES,
  UPLOAD_DIR,
};
