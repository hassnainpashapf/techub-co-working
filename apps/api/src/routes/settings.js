const express = require('express');
const { z } = require('zod');
const multer = require('multer');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { saveFile, readStream, fileExists, removeFile } = require('../lib/storage');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin'));

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Tenant-level key/value settings. GET → {key: value}; PUT upserts each pair.
const settingsSchema = z.object({
  settings: z.record(z.string(), z.string().min(1)),
});

router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.setting.findMany({ where: tenantFilter(req) });
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

router.put('/', validateBody(settingsSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const entries = Object.entries(req.body.settings);
    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { tenantId_key: { tenantId: tf.tenantId, key } },
        update: { value },
        create: { tenantId: tf.tenantId, key, value },
      });
    }
    const rows = await prisma.setting.findMany({ where: tf });
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

// --------------------------------------------------------------- branding ---
const brandingSchema = z.object({
  name: z.string().min(1).optional(),
  tagline: z.string().optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

router.get('/branding', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { id: true, name: true, slug: true, email: true, phone: true, address: true, tagline: true, primaryColor: true, logoPath: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json({ branding: { ...tenant, hasLogo: !!tenant.logoPath, logoPath: undefined } });
  } catch (err) { return next(err); }
});

router.put('/branding', validateBody(brandingSchema), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.update({
      where: { id: req.user.tenantId },
      data: {
        ...(req.body.name ? { name: req.body.name } : {}),
        tagline: req.body.tagline ?? undefined,
        primaryColor: req.body.primaryColor ?? undefined,
        email: req.body.email ?? undefined,
        phone: req.body.phone ?? undefined,
        address: req.body.address ?? undefined,
      },
      select: { id: true, name: true, tagline: true, primaryColor: true, email: true, phone: true, address: true },
    });
    res.json({ branding: { ...tenant, hasLogo: undefined } });
  } catch (err) { return next(err); }
});

// Upload logo (PNG/JPG/WebP/SVG, 5MB)
router.post('/branding/logo', logoUpload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Logo must be PNG, JPG, WebP or SVG' });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId }, select: { logoPath: true } });
    if (tenant?.logoPath) removeFile(tenant.logoPath);
    // Reuse storage lib but bypass its mime allowlist via direct write
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const dir = path.join(require('../lib/storage').UPLOAD_DIR, req.user.tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(req.file.originalname).slice(0, 8) || '.png';
    const fullPath = path.join(dir, `logo-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    fs.writeFileSync(fullPath, req.file.buffer);
    await prisma.tenant.update({ where: { id: req.user.tenantId }, data: { logoPath: fullPath } });
    res.json({ ok: true });
  } catch (err) { return next(err); }
});

router.delete('/branding/logo', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId }, select: { logoPath: true } });
    if (tenant?.logoPath) removeFile(tenant.logoPath);
    await prisma.tenant.update({ where: { id: req.user.tenantId }, data: { logoPath: null } });
    res.json({ ok: true });
  } catch (err) { return next(err); }
});

module.exports = router;
