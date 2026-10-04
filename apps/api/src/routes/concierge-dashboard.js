// Phase 55 Track 10: Concierge Dashboard.
// Mount: app.use('/api/concierge-dashboard', require('./routes/concierge-dashboard'));
// COORDINATOR: schema merge (ServiceRequest/ServiceRating/ConciergeService) hote hi live.
// Sidebar link: { label: 'Concierge', path: '/concierge' } — roles: ceo/admin/super_admin/manager.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

const OPEN_STATUSES = ['new', 'accepted', 'in_progress'];
const SLA_HOURS = { urgent: 2, high: 8, normal: 24, low: 48 };

function m(name) {
  try {
    return prisma && prisma[name] ? prisma[name] : null;
  } catch (_) {
    return null;
  }
}

function toNum(v) {
  if (v == null) return null;
  const n = typeof v === 'object' && v.toNumber ? v.toNumber() : Number(v);
  return Number.isFinite(n) ? n : null;
}

// GET /api/concierge-dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const thirty = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const out = {
      openRequests: 0,
      byStatus: {},
      avgCompletionHours: null,
      avgRating: null,
      ratingCount: 0,
      revenue30d: 0,
      slaBreaches: 0,
      topServices: [],
      modules: { requests: false, ratings: false, services: false },
    };

    const reqs = m('serviceRequest');
    if (reqs) {
      out.modules.requests = true;
      try {
        out.openRequests = await reqs.count({ where: { ...tf, status: { in: OPEN_STATUSES } } });
      } catch (_) {}
      try {
        const grouped = await reqs.groupBy({ by: ['status'], where: tf, _count: { _all: true } });
        for (const g of grouped) out.byStatus[g.status] = g._count._all;
      } catch (_) {}
      // avg completion time (done, 30d)
      try {
        const done = await reqs.findMany({
          where: { ...tf, status: 'done', completedAt: { gte: thirty } },
          select: { createdAt: true, completedAt: true, price: true, serviceId: true, priority: true },
        });
        const hours = [];
        let revenue = 0;
        for (const r of done) {
          if (r.createdAt && r.completedAt) {
            const h = (new Date(r.completedAt) - new Date(r.createdAt)) / 3600000;
            if (h >= 0) hours.push(h);
          }
          const p = toNum(r.price);
          if (p != null) revenue += p;
        }
        out.avgCompletionHours = hours.length
          ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
          : null;
        out.revenue30d = Math.round(revenue * 100) / 100;
      } catch (_) {}
      // SLA breaches: open requests past SLA hours
      try {
        const open = await reqs.findMany({
          where: { ...tf, status: { in: OPEN_STATUSES } },
          select: { createdAt: true, priority: true },
          take: 500,
        });
        const now = Date.now();
        out.slaBreaches = open.filter((r) => {
          const sla = SLA_HOURS[r.priority] ?? SLA_HOURS.normal;
          return now - new Date(r.createdAt).getTime() > sla * 3600000;
        }).length;
      } catch (_) {}
      // top services (30d)
      try {
        const grp = await reqs.groupBy({
          by: ['serviceId'],
          where: { ...tf, createdAt: { gte: thirty }, serviceId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { _all: 'desc' } },
          take: 5,
        });
        const ids = grp.map((g) => g.serviceId).filter(Boolean);
        const svc = m('conciergeService');
        let names = {};
        if (svc && ids.length) {
          const rows = await svc.findMany({ where: { ...tf, id: { in: ids } }, select: { id: true, name: true } });
          names = Object.fromEntries(rows.map((r) => [r.id, r.name]));
          out.modules.services = true;
        }
        out.topServices = grp.map((g) => ({ serviceId: g.serviceId, name: names[g.serviceId] || '—', count: g._count._all }));
      } catch (_) {}
    }

    const ratings = m('serviceRating');
    if (ratings) {
      out.modules.ratings = true;
      try {
        const rows = await ratings.findMany({
          where: { ...tf, createdAt: { gte: thirty } },
          select: { rating: true },
        });
        out.ratingCount = rows.length;
        out.avgRating = rows.length
          ? Math.round((rows.reduce((a, r) => a + (Number(r.rating) || 0), 0) / rows.length) * 10) / 10
          : null;
      } catch (_) {}
    }

    return res.json(out);
  } catch (_) {
    return res.json({
      openRequests: 0, byStatus: {}, avgCompletionHours: null, avgRating: null,
      ratingCount: 0, revenue30d: 0, slaBreaches: 0, topServices: [],
      modules: { requests: false, ratings: false, services: false },
    });
  }
});

// GET /api/concierge-dashboard/open?limit=10 — open requests preview
router.get('/open', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const reqs = m('serviceRequest');
    if (!reqs) return res.json({ open: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    let rows = [];
    try {
      rows = await reqs.findMany({
        where: { ...tf, status: { in: OPEN_STATUSES } },
        orderBy: { createdAt: 'asc' },
        take: limit,
        include: { member: { select: { name: true, email: true } }, service: { select: { name: true } } },
      });
    } catch (_) {
      rows = [];
    }
    const now = Date.now();
    const open = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      member: r.member ? r.member.name || r.member.email : '—',
      service: r.service ? r.service.name : '—',
      createdAt: r.createdAt,
      sla: (() => {
        const sla = SLA_HOURS[r.priority] ?? SLA_HOURS.normal;
        return now - new Date(r.createdAt).getTime() > sla * 3600000 ? 'breached' : 'ok';
      })(),
    }));
    return res.json({ open });
  } catch (_) {
    return res.json({ open: [] });
  }
});

module.exports = router;
