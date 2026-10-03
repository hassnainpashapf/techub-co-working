// Phase 50 Track 10/10: Legal Dashboard.
// Coordinator: mount -> app.use('/api/legal-dashboard', require('./routes/legal-dashboard')); (server.js)
// Sidebar: { label: '⚖️ Legal & Compliance', path: '/legal' } — roles: ceo/admin/super_admin/manager

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);
router.get('/stats', requireRole('ceo', 'admin', 'super_admin', 'manager'), async (req, res) => {
  try {
    const prisma = require('../lib/prisma');
    const tf = tenantFilter(req);
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const missing = [];

    // 1. Pending policy acks
    let pendingAcks = null;
    if (prisma.policy) {
      try {
        const policies = await prisma.policy.findMany({
          where: { ...tf, isActive: true, requiresAck: true },
          select: { id: true, title: true, requiresAck: true },
        });
        const acked = prisma.policyAck
          ? await prisma.policyAck.findMany({ where: { ...tf }, select: { policyId: true } })
          : [];
        const ackedIds = new Set(acked.map((a) => a.policyId));
        const pending = policies.filter((p) => !ackedIds.has(p.id));
        pendingAcks = { count: pending.length, policies: pending.slice(0, 8) };
      } catch (e) { pendingAcks = { count: 0, policies: [], error: 'query_failed' }; }
    } else missing.push('Policy');

    // 2. Overdue compliance items
    let overdueCompliance = null;
    if (prisma.complianceItem) {
      try {
        overdueCompliance = await prisma.complianceItem.count({
          where: { ...tf, status: { in: ['pending', 'overdue'] }, dueDate: { lt: now } },
        });
      } catch (e) { overdueCompliance = 0; }
    } else missing.push('ComplianceItem');

    // 3. Expiring legal documents (30d)
    let expiringDocs = null;
    if (prisma.legalDocument) {
      try {
        expiringDocs = await prisma.legalDocument.findMany({
          where: { ...tf, expiresAt: { gte: now, lte: in30 }, status: { not: 'expired' } },
          select: { id: true, title: true, category: true, expiresAt: true },
          orderBy: { expiresAt: 'asc' },
          take: 10,
        });
      } catch (e) { expiringDocs = []; }
    } else missing.push('LegalDocument');

    // 4. Open incidents
    let openIncidents = null;
    if (prisma.incident) {
      try {
        openIncidents = await prisma.incident.count({
          where: { ...tf, status: { in: ['open', 'investigating'] } },
        });
      } catch (e) { openIncidents = 0; }
    } else missing.push('Incident');

    // 5. Expiring insurance (60d)
    let expiringInsurance = null;
    if (prisma.insurancePolicy) {
      try {
        const in60 = new Date(now.getTime() + 60 * 24 * 3600 * 1000);
        expiringInsurance = await prisma.insurancePolicy.findMany({
          where: { ...tf, endDate: { gte: now, lte: in60 } },
          select: { id: true, provider: true, policyNumber: true, endDate: true },
          orderBy: { endDate: 'asc' },
          take: 10,
        });
      } catch (e) { expiringInsurance = []; }
    } else missing.push('InsurancePolicy');

    // 6. Non-compliant vendors
    let nonCompliantVendors = null;
    if (prisma.vendor) {
      try {
        nonCompliantVendors = await prisma.vendor.count({
          where: {
            ...tf,
            OR: [
              { complianceStatus: { in: ['pending', 'expired'] } },
              { complianceExpiry: { lt: now } },
            ],
          },
        });
      } catch (e) { nonCompliantVendors = null; } // delta columns may not be merged yet
    } else missing.push('Vendor');

    return res.json({
      pendingAcks,
      overdueCompliance,
      expiringDocs,
      expiringDocsCount: Array.isArray(expiringDocs) ? expiringDocs.length : null,
      openIncidents,
      expiringInsurance,
      expiringInsuranceCount: Array.isArray(expiringInsurance) ? expiringInsurance.length : null,
      nonCompliantVendors,
      missing,
    });
  } catch (e) {
    return res.status(500).json({ error: 'stats_failed' });
  }
});

module.exports = router;
