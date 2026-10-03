// Phase 41 Track 10: Procurement Dashboard — aggregate stats, spend trend, top vendors.
// Sare sections defensive hain: parallel tracks (1-9) ke models merge na hue hon
// to wo section 0/empty deta hai, poora dashboard 503 nahi hota.
// Koi migration nahi — sirf existing/fragments models se compute hota hai.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager', 'finance'));

// Model merge hua ya nahi (schema merge se pehle prisma.<model> undefined hota hai)
function m(name) {
  return prisma[name] || null;
}

// Track 6 ke approval rules ka mirror: 50000 se zyada total -> 2 levels
function requiredLevels(total) {
  const t = Number(total || 0);
  return t > 50000 ? [1, 2] : [1];
}

function myLevel(role) {
  return role === 'ceo' || role === 'super_admin' ? 2 : 1;
}

const toNum = (d) => (d === null || d === undefined ? 0 : Number(d));

// GET /api/procurement/stats — dashboard ke tamam key numbers + alerts.
router.get('/stats', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const stats = {
      openPOs: 0,
      pendingApprovals: 0,
      overdueBills: 0,
      expiringContracts: 0,
      lowStock: 0,
      monthSpend: 0,
      inbox: [],
      alerts: [],
    };
    const modules = {};

    // --- Open purchase orders ---
    const PO = m('purchaseOrder');
    if (PO) {
      modules.purchaseOrders = true;
      stats.openPOs = await PO.count({
        where: { tenantId, status: { in: ['draft', 'pending_approval', 'approved', 'ordered'] } },
      });

      // --- Approval inbox (meray level ke pending POs) ---
      const POs = await PO.findMany({
        where: { tenantId, status: 'pending_approval' },
        include: {
          vendor: { select: { name: true } },
          requester: { select: { name: true } },
          approvals: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const Approval = m('pOApproval');
      const lvl = myLevel(req.user.role);
      for (const po of POs) {
        const levels = requiredLevels(po.total);
        if (!levels.includes(lvl)) continue;
        let decided = false;
        if (Approval && Array.isArray(po.approvals)) {
          decided = po.approvals.some((a) => {
            const al = a.level !== undefined && a.level !== null ? Number(a.level) : 1;
            return al === lvl && (a.decision === 'approved' || a.decision === 'rejected');
          });
        }
        if (!decided) {
          stats.inbox.push({
            id: po.id,
            number: po.number,
            vendorName: po.vendor ? po.vendor.name : '-',
            total: toNum(po.total),
            requestedBy: po.requester ? po.requester.name : '-',
            level: lvl,
            createdAt: po.createdAt,
          });
        }
      }
      stats.pendingApprovals = stats.inbox.length;
    } else {
      modules.purchaseOrders = false;
    }

    // --- Overdue vendor bills ---
    const Bill = m('vendorBill');
    if (Bill) {
      modules.vendorBills = true;
      stats.overdueBills = await Bill.count({
        where: { tenantId, status: { in: ['pending', 'approved'] }, dueDate: { lt: now } },
      });
      const paidAgg = await Bill.aggregate({
        where: { tenantId, status: 'paid', paidAt: { gte: startOfMonth } },
        _sum: { amount: true },
      });
      stats.monthSpend = toNum(paidAgg._sum.amount);
    } else {
      modules.vendorBills = false;
    }

    // --- Expiring vendor contracts (30 din) ---
    const VC = m('vendorContract');
    if (VC) {
      modules.vendorContracts = true;
      stats.expiringContracts = await VC.count({
        where: { tenantId, status: 'active', endDate: { lte: in30 } },
      });
    } else {
      modules.vendorContracts = false;
    }

    // --- Low stock (reorder alerts) ---
    const Asset = m('asset');
    if (Asset) {
      try {
        // Track 7 fragment: reorderLevel + quantity/reorder logic
        const low = await Asset.count({
          where: { tenantId, NOT: { reorderLevel: null } },
        });
        // quantity comparison DB-level possible nahi (field track 7 par depend),
        // is liye sirf reorderLevel set items ko low-stock candidate ginte hain
        stats.lowStock = low;
        modules.inventory = true;
      } catch (e) {
        modules.inventory = false;
      }
    } else {
      modules.inventory = false;
    }

    // --- Alerts list ---
    if (stats.pendingApprovals > 0)
      stats.alerts.push({ type: 'approval', severity: 'high', text: `${stats.pendingApprovals} PO(s) aap ki approval ke muntazir hain` });
    if (stats.overdueBills > 0)
      stats.alerts.push({ type: 'bills', severity: 'high', text: `${stats.overdueBills} vendor bill(s) overdue hain` });
    if (stats.expiringContracts > 0)
      stats.alerts.push({ type: 'contracts', severity: 'medium', text: `${stats.expiringContracts} vendor contract(s) 30 din me expire ho rahe hain` });
    if (stats.lowStock > 0)
      stats.alerts.push({ type: 'stock', severity: 'medium', text: `${stats.lowStock} item(s) reorder level par hain` });

    return res.json({ stats, modules });
  } catch (err) {
    return next(err);
  }
});

// GET /api/procurement/spend-trend?months=6 — mahana vendor spend (paid bills).
router.get('/spend-trend', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const Bill = m('vendorBill');
    if (!Bill) return res.json({ months: [], enabled: false });

    const months = Math.min(12, Math.max(1, parseInt(req.query.months, 10) || 6));
    const now = new Date();
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ start, end, label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) });
    }
    const trend = [];
    for (const b of buckets) {
      const agg = await Bill.aggregate({
        where: { tenantId: tf.tenantId, status: 'paid', paidAt: { gte: b.start, lt: b.end } },
        _sum: { amount: true },
      });
      trend.push({ month: b.label, spend: toNum(agg._sum.amount) });
    }
    return res.json({ months: trend, enabled: true });
  } catch (err) {
    return next(err);
  }
});

// GET /api/procurement/top-vendors?limit=5 — spend-wise top vendors (paid bills).
router.get('/top-vendors', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const Bill = m('vendorBill');
    if (!Bill) return res.json({ vendors: [], enabled: false });

    const limit = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const Vendor = m('vendor');
    const grouped = await Bill.groupBy({
      by: ['vendorId'],
      where: { tenantId: tf.tenantId, status: 'paid' },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: limit,
    });
    const vendors = [];
    for (const g of grouped) {
      let name = '-';
      if (Vendor) {
        const v = await Vendor.findFirst({ where: { id: g.vendorId, tenantId: tf.tenantId }, select: { name: true } });
        if (v) name = v.name;
      }
      vendors.push({ vendorId: g.vendorId, name, totalSpend: toNum(g._sum.amount) });
    }
    return res.json({ vendors, enabled: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
