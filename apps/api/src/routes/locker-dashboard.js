// Phase 56 Track 10: Locker Dashboard.
// Mount: app.use('/api/locker-dashboard', require('./routes/locker-dashboard'));
// COORDINATOR: Locker (Track 1) + LockerRental (Track 2) + LockerWaitlist (Track 6) +
// LockerMaintenance (Track 7) fragments merge hote hi sections auto-live.
// Sidebar link: { label: 'Lockers', path: '/lockers/dashboard' } — roles: ceo/admin/super_admin/manager.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

function m(name) {
  try {
    return prisma && prisma[name] ? prisma[name] : null;
  } catch (_) {
    return null;
  }
}

function toNum(v) {
  if (v == null) return null;
  const n = typeof v === 'object' && v !== null && typeof v.toNumber === 'function' ? v.toNumber() : Number(v);
  return Number.isFinite(n) ? n : null;
}

function zeroStats() {
  return {
    total: 0,
    available: 0,
    occupied: 0,
    reserved: 0,
    maintenance: 0,
    occupancyPct: 0,
    activeRentals: 0,
    monthlyRevenue: 0,
    expiring7d: [],
    expiring7dCount: 0,
    waitlistCount: 0,
    maintenanceOpen: 0,
    modules: { lockers: false, rentals: false, waitlist: false, maintenance: false },
  };
}

// GET /api/locker-dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const out = zeroStats();

    const lockers = m('locker');
    if (lockers) {
      out.modules.lockers = true;
      try {
        const grouped = await lockers.groupBy({ by: ['status'], where: tf, _count: { _all: true } });
        for (const g of grouped) {
          const n = g._count._all;
          out.total += n;
          if (g.status === 'available') out.available = n;
          else if (g.status === 'occupied') out.occupied = n;
          else if (g.status === 'reserved') out.reserved = n;
          else if (g.status === 'maintenance') out.maintenance = n;
        }
        out.occupancyPct = out.total ? Math.round((out.occupied / out.total) * 1000) / 10 : 0;
      } catch (_) {}
    }

    const rentals = m('lockerRental');
    if (rentals) {
      out.modules.rentals = true;
      try {
        out.activeRentals = await rentals.count({ where: { ...tf, status: 'active' } });
      } catch (_) {}
      try {
        const rows = await rentals.findMany({
          where: { ...tf, status: 'active' },
          select: { monthlyRate: true },
          take: 5000,
        });
        let sum = 0;
        for (const r of rows) {
          const v = toNum(r.monthlyRate);
          if (v != null) sum += v;
        }
        out.monthlyRevenue = Math.round(sum * 100) / 100;
      } catch (_) {}
      try {
        const now = new Date();
        const in7d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        out.expiring7dCount = await rentals.count({
          where: { ...tf, status: 'active', endDate: { gte: now, lte: in7d } },
        });
        const rows = await rentals.findMany({
          where: { ...tf, status: 'active', endDate: { gte: now, lte: in7d } },
          orderBy: { endDate: 'asc' },
          take: 20,
          include: {
            locker: { select: { code: true, location: true } },
            member: { select: { name: true, email: true } },
          },
        });
        out.expiring7d = rows.map((r) => ({
          id: r.id,
          lockerCode: r.locker ? r.locker.code : '—',
          location: r.locker && r.locker.location ? r.locker.location : '',
          member: r.member ? r.member.name || r.member.email : '—',
          endDate: r.endDate,
          autoRenew: !!r.autoRenew,
        }));
      } catch (_) {}
    }

    // Waitlist: Track 6 ka LockerWaitlist (status: waiting | offered | declined).
    const waitlist = m('lockerWaitlist');
    if (waitlist) {
      out.modules.waitlist = true;
      try {
        out.waitlistCount = await waitlist.count({ where: { ...tf, status: 'waiting' } });
      } catch (_) {}
    }

    // Maintenance open: Track 7 ka LockerMaintenance (status: open | fixed).
    const maint = m('lockerMaintenance');
    if (maint) {
      out.modules.maintenance = true;
      try {
        out.maintenanceOpen = await maint.count({ where: { ...tf, status: 'open' } });
      } catch (_) {}
    }

    return res.json(out);
  } catch (_) {
    return res.json(zeroStats());
  }
});

module.exports = router;
