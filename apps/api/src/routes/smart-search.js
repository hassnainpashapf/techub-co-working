// Phase 45 Track 3: Global Smart Search.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/smart-search', require('./routes/smart-search'));
// NOTE: koi migration nahi — sirf maujooda models par read queries.
// Topbar integration note file ke bottom me hai.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);
router.use(requireRole('manager', 'admin', 'ceo', 'super_admin', 'receptionist', 'ops'));

const PER_ENTITY = 5;
const ENTITY_TIMEOUT_MS = 4000;

function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error('search-timeout')), ms)),
  ]);
}

// Relevance score: exact-ish match > prefix > contains
function scoreOf(haystack, q) {
  const h = String(haystack || '').toLowerCase();
  const needle = q.toLowerCase();
  if (!h) return 0;
  if (h === needle) return 100;
  if (h.startsWith(needle)) return 70;
  if (h.includes(needle)) return 40;
  return 10;
}

function hasModel(name) {
  return prisma && typeof prisma[name]?.findMany === 'function';
}

// Har searcher: { entity, label } wale result rows return karta hai.
// Ek searcher fail/timeout ho to baqi aate hain (allSettled).
const searchers = [
  async function members(q, tf) {
    if (!hasModel('member')) return [];
    const rows = await prisma.member.findMany({
      where: {
        ...tf,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { companyName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true, companyName: true, status: true },
      take: PER_ENTITY,
    });
    return rows.map((m) => ({
      entity: 'members',
      label: 'Member',
      id: m.id,
      title: m.name,
      subtitle: [m.email, m.companyName, m.status].filter(Boolean).join(' · '),
      link: '/members',
      score: Math.max(scoreOf(m.name, q), scoreOf(m.email, q)),
    }));
  },

  async function invoices(q, tf) {
    if (!hasModel('invoice')) return [];
    const rows = await prisma.invoice.findMany({
      where: {
        ...tf,
        OR: [
          { number: { contains: q, mode: 'insensitive' } },
          { member: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        number: true,
        status: true,
        member: { select: { name: true } },
      },
      take: PER_ENTITY,
    });
    return rows.map((i) => ({
      entity: 'invoices',
      label: 'Invoice',
      id: i.id,
      title: i.number,
      subtitle: [i.member?.name, i.status].filter(Boolean).join(' · '),
      link: '/billing',
      score: Math.max(scoreOf(i.number, q), scoreOf(i.member?.name, q)),
    }));
  },

  async function bookings(q, tf) {
    if (!hasModel('booking')) return [];
    const rows = await prisma.booking.findMany({
      where: {
        ...tf,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { member: { name: { contains: q, mode: 'insensitive' } } },
          { unit: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        startAt: true,
        member: { select: { name: true } },
        unit: { select: { name: true } },
      },
      take: PER_ENTITY,
    });
    return rows.map((b) => ({
      entity: 'bookings',
      label: 'Booking',
      id: b.id,
      title: b.title,
      subtitle: [b.member?.name, b.unit?.name, b.status].filter(Boolean).join(' · '),
      link: '/bookings',
      score: Math.max(scoreOf(b.title, q), scoreOf(b.member?.name, q), scoreOf(b.unit?.name, q)),
    }));
  },

  async function eventTickets(q, tf) {
    if (!hasModel('eventTicket')) return [];
    const rows = await prisma.eventTicket.findMany({
      where: {
        ...tf,
        OR: [
          { buyerName: { contains: q, mode: 'insensitive' } },
          { buyerEmail: { contains: q, mode: 'insensitive' } },
          { event: { title: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        buyerName: true,
        buyerEmail: true,
        status: true,
        event: { select: { title: true } },
      },
      take: PER_ENTITY,
    });
    return rows.map((t) => ({
      entity: 'tickets',
      label: 'Event ticket',
      id: t.id,
      title: t.buyerName,
      subtitle: [t.buyerEmail, t.event?.title, t.status].filter(Boolean).join(' · '),
      link: '/events',
      score: Math.max(scoreOf(t.buyerName, q), scoreOf(t.buyerEmail, q)),
    }));
  },

  async function contracts(q, tf) {
    if (!hasModel('contract')) return [];
    const rows = await prisma.contract.findMany({
      where: {
        ...tf,
        OR: [
          { member: { name: { contains: q, mode: 'insensitive' } } },
          { unit: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        status: true,
        member: { select: { name: true } },
        unit: { select: { name: true } },
      },
      take: PER_ENTITY,
    });
    return rows.map((c) => ({
      entity: 'contracts',
      label: 'Contract',
      id: c.id,
      title: `${c.member?.name || 'Member'} — ${c.unit?.name || 'Unit'}`,
      subtitle: String(c.status || ''),
      link: '/procurement/contracts',
      score: Math.max(scoreOf(c.member?.name, q), scoreOf(c.unit?.name, q)),
    }));
  },

  async function vendors(q, tf) {
    if (!hasModel('vendor')) return [];
    const rows = await prisma.vendor.findMany({
      where: {
        ...tf,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { company: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, company: true, email: true, category: true },
      take: PER_ENTITY,
    });
    return rows.map((v) => ({
      entity: 'vendors',
      label: 'Vendor',
      id: v.id,
      title: v.name,
      subtitle: [v.company, v.email, v.category].filter(Boolean).join(' · '),
      link: '/procurement/vendors',
      score: Math.max(scoreOf(v.name, q), scoreOf(v.company, q)),
    }));
  },

  async function events(q, tf) {
    if (!hasModel('communityEvent')) return [];
    const rows = await prisma.communityEvent.findMany({
      where: {
        ...tf,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, title: true, location: true, status: true, startsAt: true },
      take: PER_ENTITY,
    });
    return rows.map((e) => ({
      entity: 'events',
      label: 'Event',
      id: e.id,
      title: e.title,
      subtitle: [e.location, e.status].filter(Boolean).join(' · '),
      link: '/events',
      score: Math.max(scoreOf(e.title, q), scoreOf(e.location, q)),
    }));
  },
];

// GET /api/smart-search?q=...
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'q must be at least 2 characters' });
    }
    const tf = tenantFilter(req);

    const settled = await Promise.allSettled(
      searchers.map((fn) => withTimeout(fn(q, tf), ENTITY_TIMEOUT_MS))
    );

    let results = [];
    const failedEntities = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') {
        results = results.concat(s.value || []);
      } else {
        failedEntities.push(searchers[i].name);
      }
    });

    // Score ke hisab se sort, phir entity order
    results.sort((a, b) => b.score - a.score);

    const groups = {};
    for (const r of results) {
      (groups[r.entity] = groups[r.entity] || []).push(r);
    }

    return res.json({
      query: q,
      total: results.length,
      results: results.slice(0, 30),
      groups,
      ...(failedEntities.length ? { partial: true, failedEntities } : {}),
    });
  } catch (e) {
    return res.status(500).json({ error: 'search failed' });
  }
});

module.exports = router;

// ------------------------------------------------------- Topbar integration
// File: apps/web/components/Topbar.js
// Topbar me search input add karein:
//   const [q, setQ] = useState('');
//   const [hits, setHits] = useState([]);
//   onChange (debounced 300ms) → api.get(`/smart-search?q=${encodeURIComponent(q)}`)
// Dropdown me grouped results (entity label + title + subtitle), click par
// result.link par navigate. Esc/blur par close. Sirf staff roles ko dikhaye.
