// Phase 45 Track 8: Smart Pricing Suggestions (advisory only — koi auto price change nahi).
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/smart-pricing', require('./routes/smart-pricing'));
// Koi migration nahi — existing Unit/Contract/Booking/CommunityEvent/TicketType/EventTicket data se compute.
//
// Frontend integration notes (coordinator):
//   - Units page: har unit-type card par "💡 Pricing hints" chip → GET /api/smart-pricing/units
//   - Event dashboard / ticket types tab: "💡 Pricing hints" → GET /api/smart-pricing/events/:eventId
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);
const STAFF = ['manager', 'admin', 'ceo', 'super_admin'];
router.use(requireRole(...STAFF));

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ---------------------------------------------------------------- GET /units
// Har unit TYPE par: 90-day occupancy + demand trend → advisory suggestion.
router.get('/units', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const now = new Date();
    const windowStart = daysAgo(90);

    // Sab units (tenant-scoped) type-wise group karne ke liye.
    const units = await prisma.unit.findMany({
      where: { ...tf },
      select: { id: true, type: true, monthlyPrice: true, status: true },
    });
    if (!units.length) return res.json({ suggestions: [], note: 'koi unit nahi' });

    const byType = {};
    for (const u of units) {
      (byType[u.type] = byType[u.type] || []).push(u);
    }

    const suggestions = [];
    for (const [type, list] of Object.entries(byType)) {
      const unitIds = list.map((u) => u.id);
      const totalUnits = list.length;

      // Occupancy: abhi active contracts (endDate null ya future) — occupied unit count.
      const activeContracts = await prisma.contract.count({
        where: {
          ...tf,
          unitId: { in: unitIds },
          status: 'active',
          OR: [{ endDate: null }, { endDate: { gte: now } }],
        },
      });
      const occupancyRate = totalUnits ? activeContracts / totalUnits : 0;

      // Demand trend: bookings (last 45d vs previous 45d) iss unit type par.
      const [recentBookings, prevBookings] = await Promise.all([
        prisma.booking.count({
          where: { ...tf, unitId: { in: unitIds }, startAt: { gte: daysAgo(45) }, status: 'confirmed' },
        }),
        prisma.booking.count({
          where: {
            ...tf,
            unitId: { in: unitIds },
            startAt: { gte: daysAgo(90), lt: daysAgo(45) },
            status: 'confirmed',
          },
        }),
      ]);
      const trendPct = prevBookings
        ? ((recentBookings - prevBookings) / prevBookings) * 100
        : recentBookings > 0
        ? 100
        : 0;

      // Avg current price iss type ka.
      const avgPrice =
        list.reduce((s, u) => s + Number(u.monthlyPrice || 0), 0) / Math.max(1, totalUnits);

      let action = 'keep';
      let suggestedChangePct = 0;
      let reason = '';
      if (occupancyRate >= 0.9 && trendPct >= 0) {
        action = 'raise';
        suggestedChangePct = 10;
        reason = `Occupancy ${pct(occupancyRate)} — taqreeban full; demand ${trendText(trendPct)}. Naye contracts par 5–10% izafa safe lagta hai.`;
      } else if (occupancyRate >= 0.75 && trendPct > 10) {
        action = 'raise';
        suggestedChangePct = 5;
        reason = `Occupancy ${pct(occupancyRate)} aur demand barh rahi hai (+${trendPct.toFixed(0)}%). Halka 5% izafa consider karein.`;
      } else if (occupancyRate < 0.5) {
        action = 'lower';
        suggestedChangePct = -10;
        reason = `Occupancy sirf ${pct(occupancyRate)} — khaali units zyada hain. 5–10% promo/discount se fill rate behtar ho sakti hai.`;
      } else if (occupancyRate < 0.65 && trendPct < 0) {
        action = 'lower';
        suggestedChangePct = -5;
        reason = `Occupancy ${pct(occupancyRate)}, demand gir rahi hai (${trendPct.toFixed(0)}%). Limited-time offer soch lein.`;
      } else {
        reason = `Occupancy ${pct(occupancyRate)}, demand stable (${trendText(trendPct)}). Price theek hai — koi change zaroori nahi.`;
      }

      suggestions.push({
        unitType: type,
        totalUnits,
        occupiedUnits: activeContracts,
        occupancyRate: +occupancyRate.toFixed(3),
        bookingsLast45d: recentBookings,
        bookingsPrev45d: prevBookings,
        demandTrendPct: +trendPct.toFixed(1),
        avgMonthlyPrice: +avgPrice.toFixed(2),
        action, // raise | lower | keep — sirf mashwara
        suggestedChangePct,
        suggestedPrice:
          action === 'keep' ? +avgPrice.toFixed(2) : +(avgPrice * (1 + suggestedChangePct / 100)).toFixed(2),
        reason,
        advisory: true,
      });
    }

    res.json({ generatedAt: new Date().toISOString(), windowDays: 90, suggestions });
  } catch (err) {
    res.status(500).json({ error: 'pricing suggestions failed', detail: err.message });
  }
});

// ------------------------------------------------------- GET /events/:eventId
// Ticket sales velocity → early-bird extend / price adjust ka mashwara.
router.get('/events/:eventId', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const eventId = req.params.eventId;

    const event = await prisma.communityEvent.findFirst({
      where: { id: eventId, ...tf },
      select: { id: true, title: true, startsAt: true, status: true, capacity: true },
    });
    if (!event) return res.status(404).json({ error: 'event nahi mila' });
    if (!prisma.ticketType || typeof prisma.ticketType.findMany !== 'function') {
      return res.status(503).json({ error: 'ticketing migration pending' });
    }

    const now = new Date();
    const types = await prisma.ticketType.findMany({
      where: { eventId, ...tf },
      orderBy: { price: 'asc' },
    });

    const daysToEvent = Math.max(0, Math.ceil((new Date(event.startsAt) - now) / 86400000));
    const suggestions = [];

    for (const tt of types) {
      const sold = tt.soldCount || 0;
      const remaining = Math.max(0, tt.quantity - sold);
      const sellThrough = tt.quantity ? sold / tt.quantity : 0;

      // Sales velocity: tickets last 7 days me kitne bike (purchasedAt se).
      let velocity7d = 0;
      try {
        velocity7d = await prisma.eventTicket.count({
          where: {
            ticketTypeId: tt.id,
            ...tf,
            status: { in: ['valid', 'used', 'transferred'] },
            purchasedAt: { gte: daysAgo(7) },
          },
        });
      } catch (_) {
        /* ticket model abhi merge na ho — velocity 0 */
      }
      const daysToSellout = velocity7d > 0 ? remaining / (velocity7d / 7) : null;

      const isEarlyBird = /early\s*bird/i.test(tt.name);
      let action = 'keep';
      let reason = '';

      if (isEarlyBird && sellThrough >= 0.8 && daysToEvent > 7) {
        action = 'extend_or_raise';
        reason = `Early Bird ${pct(sellThrough)} bik chuka aur event me ${daysToEvent} din baqi — quota barhao ya Regular par shift karo; demand strong hai.`;
      } else if (sellThrough < 0.2 && daysToEvent <= 14 && daysToEvent > 0) {
        action = 'promo';
        reason = `Sirf ${pct(sellThrough)} bike aur event ${daysToEvent} din me hai. Flash discount / early-bird wapas lao.`;
      } else if (daysToSellout && daysToSellout < daysToEvent && tt.isActive) {
        action = 'consider_raise';
        reason = `Is raftaar se (${velocity7d}/hafta) tickets event se pehle khatam ho jayenge — agle batch ki price 5–10% barhana soch lein.`;
      } else if (!tt.isActive && sellThrough > 0.5) {
        action = 'reactivate';
        reason = `Type band hai lekin ${pct(sellThrough)} bik chuka tha — dobara kholne par ghor karein.`;
      } else {
        reason = `${pct(sellThrough)} sold (${sold}/${tt.quantity}), velocity ${velocity7d}/hafta. Filhal theek — koi change zaroori nahi.`;
      }

      suggestions.push({
        ticketTypeId: tt.id,
        name: tt.name,
        price: Number(tt.price),
        quantity: tt.quantity,
        sold,
        remaining,
        sellThroughRate: +sellThrough.toFixed(3),
        velocityPerWeek: velocity7d,
        estDaysToSellout: daysToSellout == null ? null : +daysToSellout.toFixed(1),
        isActive: tt.isActive,
        action, // keep | promo | extend_or_raise | consider_raise | reactivate — sirf mashwara
        reason,
        advisory: true,
      });
    }

    res.json({
      event: { id: event.id, title: event.title, startsAt: event.startsAt, daysToEvent, capacity: event.capacity },
      generatedAt: new Date().toISOString(),
      suggestions,
    });
  } catch (err) {
    res.status(500).json({ error: 'event pricing suggestions failed', detail: err.message });
  }
});

function pct(x) {
  return `${(x * 100).toFixed(0)}%`;
}
function trendText(t) {
  if (t > 5) return `+${t.toFixed(0)}% barh rahi`;
  if (t < -5) return `${t.toFixed(0)}% gir rahi`;
  return 'stable';
}

module.exports = router;
