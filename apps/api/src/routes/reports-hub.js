// Phase 52 Track 10: Reports Hub Dashboard — API.
// Coordinator: mount with app.use('/api/reports-hub', require('./routes/reports-hub'));
// Sidebar link: { label: 'Custom Reports', path: '/reports' } — roles: ceo/admin/super_admin/manager
// NOTE: tracks 1–9 ke models (CustomReport, ReportSchedule, ReportAlert) merge se
// pehle har section defensive hai — model missing ho to wo section empty/0 aata
// hai, poora endpoint 500 nahi hota.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

// Runs (30d): audit_logs me 'custom-report.run' entries gin'te hain (koi alag
// ReportRun model nahi — audit trail se hi count, honest metric).
async function countRuns30d(tf) {
  if (!prisma.auditLog) return null;
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    return await prisma.auditLog.count({
      where: { ...tf, action: { startsWith: 'custom-report' }, createdAt: { gte: since } },
    });
  } catch {
    return null;
  }
}

router.get('/stats', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const missing = [];

    // --- 1. Custom reports ---
    let totalReports = 0;
    let myReports = 0;
    let sharedReports = 0;
    let popular = [];
    if (prisma.customReport) {
      try {
        totalReports = await prisma.customReport.count({ where: tf });
        myReports = await prisma.customReport.count({ where: { ...tf, ownerId: req.user.id } });
        sharedReports = await prisma.customReport.count({ where: { ...tf, isPublic: true } });
        popular = await prisma.customReport.findMany({
          where: tf,
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: { id: true, name: true, entity: true, updatedAt: true, isPublic: true },
        });
      } catch {
        missing.push('customReport');
      }
    } else {
      missing.push('customReport');
    }

    // --- 2. Scheduled deliveries ---
    let scheduled = 0;
    let scheduledActive = 0;
    if (prisma.reportSchedule) {
      try {
        scheduled = await prisma.reportSchedule.count({ where: tf });
        scheduledActive = await prisma.reportSchedule.count({ where: { ...tf, isActive: true } });
      } catch {
        missing.push('reportSchedule');
      }
    } else {
      missing.push('reportSchedule');
    }

    // --- 3. KPI alerts ---
    let alertsActive = 0;
    if (prisma.reportAlert) {
      try {
        alertsActive = await prisma.reportAlert.count({ where: { ...tf, isActive: true } });
      } catch {
        missing.push('reportAlert');
      }
    } else {
      missing.push('reportAlert');
    }

    // --- 4. Runs (30d, audit se) ---
    const runs30d = await countRuns30d(tf);

    res.json({
      totalReports,
      myReports,
      sharedReports,
      scheduled,
      scheduledActive,
      alertsActive,
      runs30d,
      popular,
      missing,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
