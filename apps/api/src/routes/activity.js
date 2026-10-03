// Phase 29 Track 10: Dashboard activity feed — READ ONLY.
// Merges audit logs + recent bookings/payments/tickets into one timeline.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

// Human-friendly labels for audit actions
function auditText(log) {
  const actor = log.actor?.name || 'System';
  const action = (log.action || '').replace(/[._]/g, ' ');
  return `${actor} — ${action}${log.entity ? ` (${log.entity})` : ''}`;
}

router.get('/feed', async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const tf = tenantFilter(req);
    const items = [];

    // 1) Audit logs (with actor name)
    const logs = await prisma.auditLog.findMany({
      where: tf,
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    for (const l of logs) {
      items.push({
        time: l.createdAt,
        icon: '📝',
        text: auditText(l),
        type: 'audit',
      });
    }

    // 2) Recent bookings
    const bookings = await prisma.booking.findMany({
      where: tf,
      orderBy: { createdAt: 'desc' },
      take: Math.ceil(limit / 2),
      select: { id: true, createdAt: true, status: true, unit: { select: { code: true } }, member: { select: { name: true } } },
    }).catch(() => []);
    for (const b of bookings) {
      items.push({
        time: b.createdAt,
        icon: '📅',
        text: `Booking ${b.status || 'created'} — ${b.unit?.code || 'space'}${b.member?.name ? ` for ${b.member.name}` : ''}`,
        type: 'booking',
      });
    }

    // 3) Recent payments
    const payments = await prisma.payment.findMany({
      where: tf,
      orderBy: { createdAt: 'desc' },
      take: Math.ceil(limit / 2),
      select: { id: true, createdAt: true, amount: true, member: { select: { name: true } } },
    }).catch(() => []);
    for (const p of payments) {
      items.push({
        time: p.createdAt,
        icon: '💰',
        text: `Payment received — Rs ${Number(p.amount || 0).toLocaleString()}${p.member?.name ? ` from ${p.member.name}` : ''}`,
        type: 'payment',
      });
    }

    // 4) Recent tickets
    const tickets = await prisma.ticket.findMany({
      where: tf,
      orderBy: { createdAt: 'desc' },
      take: Math.ceil(limit / 2),
      select: { id: true, createdAt: true, title: true, status: true },
    }).catch(() => []);
    for (const t of tickets) {
      items.push({
        time: t.createdAt,
        icon: '🎫',
        text: `Ticket ${t.status || 'opened'} — ${t.title || t.id.slice(0, 8)}`,
        type: 'ticket',
      });
    }

    // Merge + sort by time desc, cap at limit
    items.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json({ items: items.slice(0, limit) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
