// Phase 50 Track 9: Vendor Compliance.
// Mount: app.use('/api/vendor-compliance', require('./routes/vendor-compliance')); → server.js
// Sidebar link nahi — procurement/vendors extend hai.
// Vendor page integration note (apps/web/app/(app)/procurement/vendors/page.js):
//   - Har vendor row/card par compliance badge: GET /api/vendor-compliance (verified=green,
//     pending=amber, expired=red, expiring-soon=orange)
//   - Vendor detail me "Compliance" section: PATCH /api/vendor-compliance/:vendorId
//     { complianceStatus, complianceExpiry, complianceDocs } + taxId edit

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);
const staffOnly = requireRole('ceo', 'admin', 'super_admin', 'manager');
router.use(staffOnly);

const STATUSES = ['pending', 'verified', 'expired'];

function vendorsEnabled() {
  return !!(prisma && prisma.vendor);
}

// Delta column maujood hai ya nahi — information_schema probe (P2022 crash se bachao).
let complianceColsCached = null;
async function hasComplianceCols() {
  if (complianceColsCached !== null) return complianceColsCached;
  try {
    const rows = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendors' AND column_name IN ('compliance_status', 'compliance_expiry')`;
    complianceColsCached = rows.length === 2;
  } catch {
    complianceColsCached = false;
  }
  return complianceColsCached;
}

function guard503(req, res, next) {
  if (!vendorsEnabled()) return res.status(503).json({ error: 'Vendor schema pending migration' });
  next();
}
router.use(guard503);

function statusOf(v, daysToExpiry = 30) {
  // Derived display status: verified lekin expiry qareeb → 'expiring_soon'.
  if (!v) return 'pending';
  if (v.complianceStatus === 'expired') return 'expired';
  if (v.complianceExpiry) {
    const days = Math.ceil((new Date(v.complianceExpiry) - Date.now()) / 86400000);
    if (days < 0) return 'expired';
    if (v.complianceStatus === 'verified' && days <= daysToExpiry) return 'expiring_soon';
  }
  return v.complianceStatus || 'pending';
}

// GET /api/vendor-compliance — sab vendors compliance summary ke sath.
router.get('/', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const cols = await hasComplianceCols();
    const vendors = await prisma.vendor.findMany({
      where: { ...tf, isActive: true },
      select: {
        id: true, name: true, company: true, email: true, phone: true,
        taxId: true, category: true, isActive: true,
      },
      orderBy: { name: 'asc' },
    });
    if (!cols) {
      return res.json({ vendors: vendors.map((v) => ({ ...v, complianceStatus: 'pending', derivedStatus: 'pending' })), migrated: false });
    }
    const full = await prisma.vendor.findMany({
      where: { ...tf, isActive: true },
      select: {
        id: true, name: true, company: true, email: true, phone: true,
        taxId: true, category: true, isActive: true,
        complianceStatus: true, complianceDocs: true, complianceExpiry: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({
      migrated: true,
      vendors: full.map((v) => ({ ...v, derivedStatus: statusOf(v) })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load vendor compliance' });
  }
});

// GET /api/vendor-compliance/non-compliant — verified nahi ya expiry qareeb/guzri hui.
router.get('/non-compliant', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const days = Math.max(1, Math.min(365, parseInt(req.query.withinDays, 10) || 30));
    const cols = await hasComplianceCols();
    if (!cols) {
      const vendors = await prisma.vendor.findMany({
        where: { ...tf, isActive: true },
        select: { id: true, name: true, company: true, email: true, phone: true, taxId: true },
      });
      return res.json({ migrated: false, vendors: vendors.map((v) => ({ ...v, derivedStatus: 'pending' })) });
    }
    const horizon = new Date(Date.now() + days * 86400000);
    const vendors = await prisma.vendor.findMany({
      where: {
        ...tf,
        isActive: true,
        OR: [
          { complianceStatus: { not: 'verified' } },
          { complianceExpiry: { lte: horizon } },
        ],
      },
      select: {
        id: true, name: true, company: true, email: true, phone: true,
        taxId: true, complianceStatus: true, complianceDocs: true, complianceExpiry: true,
      },
      orderBy: { complianceExpiry: 'asc' },
    });
    res.json({ migrated: true, vendors: vendors.map((v) => ({ ...v, derivedStatus: statusOf(v, days) })) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load non-compliant vendors' });
  }
});

// PATCH /api/vendor-compliance/:vendorId — verify/expire + docs + taxId.
const patchSchema = z.object({
  complianceStatus: z.enum(['pending', 'verified', 'expired']).optional(),
  complianceExpiry: z.string().datetime().or(z.string().date()).nullable().optional(),
  complianceDocs: z.array(z.object({
    name: z.string().max(200),
    url: z.string().max(2000),
    uploadedAt: z.string().optional(),
  })).max(20).optional(),
  taxId: z.string().max(50).nullable().optional(),
});

router.patch('/:vendorId', validateBody(patchSchema), async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const cols = await hasComplianceCols();
    if (!cols) return res.status(503).json({ error: 'Compliance fields pending migration' });
    const vendor = await prisma.vendor.findFirst({ where: { ...tf, id: req.params.vendorId } });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const data = {};
    if (req.body.complianceStatus) data.complianceStatus = req.body.complianceStatus;
    if (req.body.complianceExpiry !== undefined) {
      data.complianceExpiry = req.body.complianceExpiry ? new Date(req.body.complianceExpiry) : null;
    }
    if (req.body.complianceDocs !== undefined) data.complianceDocs = req.body.complianceDocs;
    if (req.body.taxId !== undefined) data.taxId = req.body.taxId || null;

    const updated = await prisma.vendor.update({ where: { id: vendor.id }, data });
    await writeAudit(req, {
      action: 'vendor.compliance_update',
      entity: 'Vendor', entityId: vendor.id,
      oldValue: { complianceStatus: vendor.complianceStatus },
      newValue: { complianceStatus: updated.complianceStatus, complianceExpiry: updated.complianceExpiry },
    });
    res.json({ ok: true, vendor: { ...updated, derivedStatus: statusOf(updated) } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update vendor compliance' });
  }
});

// POST /api/vendor-compliance/alerts/check — expiry scan: expired mark + notifications.
router.post('/alerts/check', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const cols = await hasComplianceCols();
    if (!cols) return res.json({ migrated: false, expired: 0, expiringSoon: 0 });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Guzri hui expiry → expired mark karo.
    const expiredNow = await prisma.vendor.updateMany({
      where: { ...tf, complianceExpiry: { lt: today }, complianceStatus: { not: 'expired' } },
      data: { complianceStatus: 'expired' },
    });

    // 30 din me expire honay wali → alert.
    const horizon = new Date(Date.now() + 30 * 86400000);
    const expiring = await prisma.vendor.findMany({
      where: { ...tf, isActive: true, complianceStatus: 'verified', complianceExpiry: { lte: horizon, gte: today } },
      select: { id: true, name: true, complianceExpiry: true },
    });

    let alerted = 0;
    if (expiring.length > 0) {
      const { createNotification } = require('../lib/notify');
      const names = expiring.map((v) => `${v.name} (${new Date(v.complianceExpiry).toISOString().slice(0, 10)})`).join(', ');
      for (const role of ['ceo', 'admin', 'manager']) {
        await createNotification(prisma, {
          tenantId: tf.tenantId, role,
          type: 'vendor.compliance_expiring',
          message: `[vendor-compliance] ${expiring.length} vendor compliance 30 din me expire: ${names}`,
        }).catch(() => {});
      }
      alerted = expiring.length;
    }

    await writeAudit(req, {
      action: 'vendor.compliance_alert_check',
      entity: 'Vendor', entityId: null,
      newValue: { markedExpired: expiredNow.count, expiringSoon: alerted },
    });
    res.json({ ok: true, migrated: true, markedExpired: expiredNow.count, expiringSoon: alerted });
  } catch (e) {
    res.status(500).json({ error: 'Compliance alert check failed' });
  }
});

module.exports = router;
