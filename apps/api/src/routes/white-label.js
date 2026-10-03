// White-label settings — tenant branding overrides stored in Setting model
// (core assets name/primaryColor/logoPath reuse phase-19 Tenant fields).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

const WL_KEYS = {
  brandName: 'whiteLabel.brandName',
  supportEmail: 'whiteLabel.supportEmail',
  customDomain: 'whiteLabel.customDomain',
  hidePoweredBy: 'whiteLabel.hidePoweredBy',
};

async function readWhiteLabel(tenantId) {
  const [rows, tenant] = await Promise.all([
    prisma.setting.findMany({ where: { tenantId, key: { in: Object.values(WL_KEYS) } } }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true, primaryColor: true, logoPath: true },
    }),
  ]);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const brandName = map[WL_KEYS.brandName] || tenant?.name || 'CoworkOS';
  return {
    brandName,
    logoUrl: tenant?.logoPath && tenant?.slug ? `/api/branding/${tenant.slug}/logo` : null,
    hasLogo: !!tenant?.logoPath,
    slug: tenant?.slug || null,
    primaryColor: tenant?.primaryColor || '#7c3aed',
    supportEmail: map[WL_KEYS.supportEmail] || null,
    customDomain: map[WL_KEYS.customDomain] || null,
    hidePoweredBy: map[WL_KEYS.hidePoweredBy] === 'true',
  };
}

// Public branding for the login page (no auth) — resolves the default tenant
// via PUBLIC_TENANT_SLUG or the first active tenant (public-bookings pattern).
router.get('/public', async (req, res, next) => {
  try {
    let tenant = null;
    const slug = process.env.PUBLIC_TENANT_SLUG;
    if (slug) tenant = await prisma.tenant.findFirst({ where: { slug, isActive: true }, select: { id: true } });
    if (!tenant) tenant = await prisma.tenant.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!tenant) return res.json({ branding: { brandName: 'CoworkOS', logoUrl: null, primaryColor: '#7c3aed', supportEmail: null, hidePoweredBy: false } });
    const b = await readWhiteLabel(tenant.id);
    return res.json({ branding: { brandName: b.brandName, logoUrl: b.logoUrl, primaryColor: b.primaryColor, supportEmail: b.supportEmail, hidePoweredBy: b.hidePoweredBy } });
  } catch (err) { return next(err); }
});

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin'));

router.get('/', async (req, res, next) => {
  try {
    return res.json({ whiteLabel: await readWhiteLabel(req.user.tenantId) });
  } catch (err) { return next(err); }
});

const whiteLabelSchema = z.object({
  brandName: z.string().min(1).max(80).optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  supportEmail: z.string().email().max(120).optional().nullable(),
  customDomain: z.string().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i).max(120).optional().nullable(),
  hidePoweredBy: z.boolean().optional(),
});

router.put('/', validateBody(whiteLabelSchema), async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const tf = tenantFilter(req);
    const { brandName, primaryColor, supportEmail, customDomain, hidePoweredBy } = req.body;

    if (primaryColor !== undefined) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { primaryColor } });
    }
    const kv = { brandName, supportEmail, customDomain };
    for (const [k, v] of Object.entries(kv)) {
      if (v === undefined) continue;
      const key = WL_KEYS[k];
      if (v === null || v === '') {
        await prisma.setting.deleteMany({ where: { ...tf, key } });
      } else {
        await prisma.setting.upsert({
          where: { tenantId_key: { tenantId, key } },
          update: { value: String(v) },
          create: { tenantId, key, value: String(v) },
        });
      }
    }
    if (hidePoweredBy !== undefined) {
      await prisma.setting.upsert({
        where: { tenantId_key: { tenantId, key: WL_KEYS.hidePoweredBy } },
        update: { value: hidePoweredBy ? 'true' : 'false' },
        create: { tenantId, key: WL_KEYS.hidePoweredBy, value: hidePoweredBy ? 'true' : 'false' },
      });
    }

    await writeAudit({
      tenantId,
      actorId: req.user.sub,
      action: 'white_label.updated',
      entity: 'Tenant',
      entityId: tenantId,
      ip: req.ip,
    }).catch(() => {});

    return res.json({ whiteLabel: await readWhiteLabel(tenantId) });
  } catch (err) { return next(err); }
});

module.exports = router;
