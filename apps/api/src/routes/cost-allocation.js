// Phase 51 Track 5: shared cost allocation API
// Coordinator: app.use('/api/cost-allocation', require('./routes/cost-allocation')); → server.js
// Sidebar link nahi — utilities extend hai.
const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const prisma = require('../lib/prisma');
const { allocateSharedBill, previewAllocation, METHODS } = require('../lib/costAllocation');

const router = express.Router();
const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];

function notMigrated(res) {
  return res.status(503).json({ error: 'Utility billing abhi migrate nahi hua — pehle phase 51 migration apply karein.' });
}

// GET /preview?utilityBillId=&method= — bina save kiye hisaab
router.get('/preview', authenticate, requireTenantUser, requireRole(STAFF), async (req, res) => {
  try {
    if (!prisma.utilityBill) return notMigrated(res);
    const r = await previewAllocation({ tenantId: req.user.tenantId, utilityBillId: req.query.utilityBillId, method: req.query.method || 'equal' });
    if (!r.ok) {
      const code = { bill_not_found: 404, not_shared_bill: 422, zero_amount: 422, no_eligible_members: 422, already_allocated: 409 }[r.reason] || 400;
      return res.status(code).json({ error: r.reason });
    }
    res.json(r);
  } catch (e) {
    console.error('cost-allocation preview error', e.message);
    res.status(500).json({ error: 'Preview me masla aya.' });
  }
});

// POST /allocate — asal allocation (per-member UtilityBill rows)
router.post('/allocate', authenticate, requireTenantUser, requireRole(STAFF), async (req, res) => {
  try {
    if (!prisma.utilityBill) return notMigrated(res);
    const schema = z.object({ utilityBillId: z.string().min(1), method: z.enum(METHODS).default('equal') });
    const { utilityBillId, method } = schema.parse(req.body);
    const r = await allocateSharedBill({ tenantId: req.user.tenantId, utilityBillId, method, actorId: req.user.id });
    if (!r.ok) {
      const code = { bill_not_found: 404, not_shared_bill: 422, zero_amount: 422, no_eligible_members: 422, already_allocated: 409 }[r.reason] || 400;
      return res.status(code).json({ error: r.reason });
    }
    res.status(201).json(r);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Ghalat input.' });
    console.error('cost-allocation allocate error', e.message);
    res.status(500).json({ error: 'Allocation me masla aya.' });
  }
});

// GET /shared-bills — abhi allocate na hue shared bills
router.get('/shared-bills', authenticate, requireTenantUser, requireRole(STAFF), async (req, res) => {
  try {
    if (!prisma.utilityBill) return notMigrated(res);
    const bills = await prisma.utilityBill.findMany({
      where: { ...tenantFilter(req), memberId: null, status: { not: 'allocated' } },
      orderBy: { periodStart: 'desc' },
      take: 50,
    });
    res.json({ bills });
  } catch (e) {
    console.error('cost-allocation shared-bills error', e.message);
    res.status(500).json({ error: 'Bills load nahi hue.' });
  }
});

module.exports = router;
