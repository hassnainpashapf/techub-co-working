// Phase 30: Global search — tenant-scoped search across entities.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser);

// GET /api/search?q=xyz
// Returns top 5 matches per entity: {id, title, subtitle, path}
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const empty = { members: [], bookings: [], invoices: [], tickets: [], units: [], companies: [] };
    if (q.length < 2) return res.json(empty);

    const contains = { contains: q, mode: 'insensitive' };
    const scope = tenantFilter(req);

    const [members, bookings, invoices, tickets, units, companies] = await Promise.all([
      prisma.member.findMany({
        where: { ...scope, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
        select: { id: true, name: true, email: true, phone: true },
        take: 5,
      }),
      prisma.booking.findMany({
        where: { ...scope, OR: [{ title: contains }, { id: q }] },
        select: { id: true, title: true, status: true, member: { select: { name: true } }, unit: { select: { code: true } } },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.invoice.findMany({
        where: { ...scope, OR: [{ number: contains }] },
        select: { id: true, number: true, status: true, member: { select: { name: true } } },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.ticket.findMany({
        where: { ...scope, title: contains },
        select: { id: true, ticketNumber: true, title: true, status: true },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.unit.findMany({
        where: { ...scope, code: contains },
        select: { id: true, code: true, type: true },
        take: 5,
      }),
      prisma.company.findMany({
        where: { ...scope, OR: [{ name: contains }, { email: contains }] },
        select: { id: true, name: true, industry: true, _count: { select: { members: true } } },
        take: 5,
      }),
    ]);

    return res.json({
      members: members.map((m) => ({
        id: m.id,
        title: m.name,
        subtitle: [m.email, m.phone].filter(Boolean).join(' · '),
        path: '/members',
      })),
      bookings: bookings.map((b) => ({
        id: b.id,
        title: b.title,
        subtitle: [b.unit?.code, b.member?.name, b.status].filter(Boolean).join(' · '),
        path: '/bookings',
      })),
      invoices: invoices.map((i) => ({
        id: i.id,
        title: i.number,
        subtitle: [i.member?.name, i.status].filter(Boolean).join(' · '),
        path: '/billing',
      })),
      tickets: tickets.map((t) => ({
        id: t.id,
        title: `#${t.ticketNumber} ${t.title}`,
        subtitle: String(t.status),
        path: '/tickets',
      })),
      units: units.map((u) => ({
        id: u.id,
        title: u.code,
        subtitle: String(u.type || ''),
        path: '/discover',
      })),
      companies: companies.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: [c.industry, `${c._count.members} members`].filter(Boolean).join(' · '),
        path: '/companies',
      })),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
