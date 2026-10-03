// Phase 44 Track 10: Event Organizer Dashboard — aggregate stats + upcoming events sales.
// Sare sections defensive hain: parallel tracks (2/3) ke models merge na hue hon
// to wo section 0/empty deta hai, poora dashboard 503 nahi hota.
// Koi migration nahi — sirf existing/fragments models se compute hota hai.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'manager'));

// Model merge hua ya nahi (schema merge se pehle prisma.<model> undefined hota hai)
function m(name) {
  return prisma[name] || null;
}

const toNum = (d) => (d === null || d === undefined ? 0 : Number(d));

// GET /api/events-dashboard/stats — organizer ke key numbers.
router.get('/stats', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const stats = {
      upcomingEvents: 0,
      ticketsSold30d: 0,
      ticketRevenue30d: 0,
      avgFillRate: 0,
      refunds30d: 0,
      activeSellEvents: 0,
    };
    const modules = {};

    // --- Upcoming events ---
    const EV = m('communityEvent');
    if (EV) {
      modules.events = true;
      stats.upcomingEvents = await EV.count({
        where: { tenantId, status: 'upcoming', startsAt: { gte: now } },
      });
    }

    // --- Tickets (track 3 ka model) ---
    const TK = m('eventTicket');
    if (TK) {
      modules.tickets = true;
      const SOLD = ['valid', 'used', 'transferred'];
      stats.ticketsSold30d = await TK.count({
        where: { tenantId, status: { in: SOLD }, purchasedAt: { gte: d30 } },
      });
      const rev = await TK.aggregate({
        where: { tenantId, status: { in: SOLD }, purchasedAt: { gte: d30 } },
        _sum: { price: true },
      });
      stats.ticketRevenue30d = toNum(rev._sum.price);
      stats.refunds30d = await TK.count({
        where: { tenantId, status: 'refunded', purchasedAt: { gte: d30 } },
      });

      // Avg fill rate: upcoming events with capacity
      if (EV) {
        const events = await EV.findMany({
          where: { tenantId, status: { in: ['upcoming', 'ongoing'] }, startsAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }, capacity: { not: null } },
          select: { id: true, capacity: true },
        });
        if (events.length) {
          const ids = events.map((e) => e.id);
          const sold = await TK.groupBy({
            by: ['eventId'],
            where: { tenantId, eventId: { in: ids }, status: { in: SOLD } },
            _count: { id: true },
          });
          const soldMap = Object.fromEntries(sold.map((s) => [s.eventId, s._count.id]));
          let sum = 0;
          let n = 0;
          for (const e of events) {
            if (e.capacity > 0) {
              sum += Math.min((soldMap[e.id] || 0) / e.capacity, 1);
              n += 1;
            }
          }
          stats.avgFillRate = n ? Math.round((sum / n) * 100) : 0;
        }
      }
    }

    // --- Active selling events (ticket types on sale) ---
    const TT = m('ticketType');
    if (TT) {
      modules.ticketTypes = true;
      const types = await TT.findMany({
        where: {
          tenantId,
          isActive: true,
          OR: [{ saleStart: null }, { saleStart: { lte: now } }],
          AND: [{ OR: [{ saleEnd: null }, { saleEnd: { gte: now } }] }],
        },
        select: { eventId: true },
      });
      stats.activeSellEvents = new Set(types.map((t) => t.eventId)).size;
    }

    return res.json({ stats, modules });
  } catch (e) {
    return next(e);
  }
});

// GET /api/events-dashboard/upcoming — upcoming events with sales progress bars.
router.get('/upcoming', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tenantId = tf.tenantId;
    const now = new Date();

    const EV = m('communityEvent');
    if (!EV) return res.json({ events: [], modules: {} });

    const events = await EV.findMany({
      where: { tenantId, status: { in: ['upcoming', 'ongoing'] }, startsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      take: 12,
      select: { id: true, title: true, startsAt: true, endsAt: true, location: true, capacity: true, status: true },
    });

    const TK = m('eventTicket');
    const TT = m('ticketType');
    const out = [];
    for (const ev of events) {
      const row = {
        id: ev.id,
        title: ev.title,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        location: ev.location,
        status: ev.status,
        capacity: ev.capacity,
        sold: 0,
        revenue: 0,
        fillRate: 0,
      };
      if (TK) {
        const SOLD = ['valid', 'used', 'transferred'];
        row.sold = await TK.count({ where: { tenantId, eventId: ev.id, status: { in: SOLD } } });
        const rev = await TK.aggregate({ where: { tenantId, eventId: ev.id, status: { in: SOLD } }, _sum: { price: true } });
        row.revenue = toNum(rev._sum.price);
      } else if (TT) {
        // Fallback: ticket type soldCount
        const agg = await TT.aggregate({ where: { tenantId, eventId: ev.id, isActive: true }, _sum: { soldCount: true } });
        row.sold = agg._sum.soldCount || 0;
      }
      if (ev.capacity && ev.capacity > 0) {
        row.fillRate = Math.round(Math.min(row.sold / ev.capacity, 1) * 100);
      }
      out.push(row);
    }

    return res.json({ events: out, modules: { events: true, tickets: !!TK, ticketTypes: !!TT } });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
