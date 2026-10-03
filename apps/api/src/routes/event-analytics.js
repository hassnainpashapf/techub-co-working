// Phase 44 Track 9: Attendee Analytics.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/event-analytics', require('./routes/event-analytics'));
// NOTE: EventTicket / TicketType models Track 3/Track 2 ke fragments se aate hain —
// migration pending ho to endpoints 503 dete hain (koi crash nahi).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);
router.use(requireRole('manager', 'admin', 'ceo', 'super_admin'));

function modelReady() {
  return (
    prisma &&
    typeof prisma.eventTicket?.findMany === 'function' &&
    typeof prisma.ticketType?.findMany === 'function'
  );
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'tickets migration pending' });
  next();
}
router.use(guard);

async function tenantEvent(req, id) {
  const tf = tenantFilter(req);
  return prisma.communityEvent.findFirst({ where: { id, ...tf } });
}

function num(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

function dayKey(d) {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(
    x.getUTCDate()
  ).padStart(2, '0')}`;
}

// GET /api/event-analytics/:eventId — full analytics snapshot
router.get('/:eventId', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const event = await tenantEvent(req, req.params.eventId);
    if (!event) return res.status(404).json({ error: 'event not found' });

    const [types, tickets] = await Promise.all([
      prisma.ticketType.findMany({ where: { eventId: event.id, ...tf } }),
      prisma.eventTicket.findMany({
        where: { eventId: event.id, ...tf },
        select: { id: true, ticketTypeId: true, status: true, price: true, purchasedAt: true },
      }),
    ]);

    const typeMap = Object.fromEntries(types.map((t) => [t.id, t]));
    const active = tickets.filter((t) => t.status !== 'refunded');

    // Tickets sold by type + revenue
    const byType = types.map((t) => {
      const sold = tickets.filter(
        (x) => x.ticketTypeId === t.id && x.status !== 'refunded'
      ).length;
      return {
        id: t.id,
        name: t.name,
        price: num(t.price),
        quantity: t.quantity,
        sold,
        remaining: Math.max(0, t.quantity - sold),
        revenue: sold * num(t.price),
      };
    });

    const revenue = byType.reduce((s, t) => s + t.revenue, 0);
    const soldCount = active.length;
    const refundCount = tickets.filter((t) => t.status === 'refunded').length;
    const usedCount = tickets.filter((t) => t.status === 'used').length;

    // Scan rate = used / valid (used + valid)
    const scannable = tickets.filter((t) => t.status === 'valid' || t.status === 'used').length;
    const scanRate = scannable ? Math.round((usedCount / scannable) * 1000) / 10 : 0;

    const refundRate = tickets.length
      ? Math.round((refundCount / tickets.length) * 1000) / 10
      : 0;

    // Sales over time (daily, purchasedAt)
    const perDay = {};
    for (const t of active) {
      const k = dayKey(t.purchasedAt);
      if (!perDay[k]) perDay[k] = { date: k, tickets: 0, revenue: 0 };
      perDay[k].tickets += 1;
      perDay[k].revenue += num(t.price);
    }
    const salesOverTime = Object.values(perDay).sort((a, b) =>
      a.date < b.date ? -1 : 1
    );

    res.json({
      event: { id: event.id, title: event.title },
      byType,
      totals: {
        sold: soldCount,
        revenue,
        used: usedCount,
        refunds: refundCount,
        scanRate,
        refundRate,
      },
      salesOverTime,
      privacyNote: 'top buyers list nahi dikhayi — privacy ke liye attendee-level names is snapshot me excluded hain',
    });
  } catch (e) {
    res.status(500).json({ error: 'analytics failed', detail: e.message });
  }
});

// GET /api/event-analytics/:eventId/attendees.csv — attendee list export
router.get('/:eventId/attendees.csv', async (req, res) => {
  try {
    const tf = tenantFilter(req);
    const event = await tenantEvent(req, req.params.eventId);
    if (!event) return res.status(404).json({ error: 'event not found' });

    const [types, tickets] = await Promise.all([
      prisma.ticketType.findMany({ where: { eventId: event.id, ...tf }, select: { id: true, name: true } }),
      prisma.eventTicket.findMany({
        where: { eventId: event.id, ...tf },
        select: {
          buyerName: true,
          buyerEmail: true,
          ticketTypeId: true,
          status: true,
          price: true,
          purchasedAt: true,
          usedAt: true,
        },
        orderBy: { purchasedAt: 'asc' },
      }),
    ]);
    const typeMap = Object.fromEntries(types.map((t) => [t.id, t.name || '']));

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = [
      ['Name', 'Email', 'Ticket Type', 'Status', 'Price', 'Purchased At', 'Used At'],
    ];
    for (const t of tickets) {
      rows.push([
        t.buyerName,
        t.buyerEmail,
        typeMap[t.ticketTypeId] || '',
        t.status,
        num(t.price).toFixed(2),
        t.purchasedAt ? new Date(t.purchasedAt).toISOString() : '',
        t.usedAt ? new Date(t.usedAt).toISOString() : '',
      ]);
    }

    const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\n');
    const fname = `attendees-${event.id}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: 'csv export failed', detail: e.message });
  }
});

module.exports = router;

// Frontend integration (coordinator): event detail page me "Analytics" tab jorein —
//   GET /api/event-analytics/:eventId → { byType, totals, salesOverTime }
//   tab me: sales curve (SVG, salesOverTime se), type breakdown (byType: sold/remaining/revenue),
//   scan rate + refund rate StatCards, "Export attendees CSV" button →
//   GET /api/event-analytics/:eventId/attendees.csv (download)
