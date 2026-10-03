// Phase 44 Track 1: Public Events Page — auth-free endpoints.
// Coordinator: server.js me /api/events ke auth routes (line 89/161) se PEHLE mount karein:
//   app.use('/api/events', require('./routes/events-public')); // public, auth-free
// Paths: /public aur /public/:slug — koi clash nahi auth routes se.
// Schema dependency: CommunityEvent par isPublic + slug + externalUrl (fragments/event-public.prisma).
'use strict';

const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');

const router = express.Router();

const tenantSlugSchema = z.object({
  tenantSlug: z.string().min(1),
});

function eventsEnabled() {
  return !!(prisma && prisma.communityEvent && prisma.tenant);
}

function publicWhere(tenantId, extra = {}) {
  return { tenantId, isPublic: true, status: 'upcoming', ...extra };
}

const publicSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  location: true,
  capacity: true,
  imageUrl: true,
  externalUrl: true,
};

// GET /api/events/public?tenantSlug=abc — aanay wale public events
router.get('/public', async (req, res) => {
  const parsed = tenantSlugSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'tenantSlug required' });
  if (!eventsEnabled()) return res.status(503).json({ error: 'events schema not merged yet' });
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { slug: parsed.data.tenantSlug, isActive: true },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const events = await prisma.communityEvent.findMany({
      where: { ...publicWhere(tenant.id), startsAt: { gte: new Date() } },
      select: publicSelect,
      orderBy: { startsAt: 'asc' },
      take: 50,
    });
    res.json({ tenant: { name: tenant.name, slug: tenant.slug }, events });
  } catch (err) {
    // merge na hua ho to P2022 (column missing) — 503, koi 500 crash nahi
    if (err && err.code === 'P2022') return res.status(503).json({ error: 'events schema not merged yet' });
    res.status(500).json({ error: 'failed to load events' });
  }
});

// GET /api/events/public/:slug?tenantSlug=abc — event detail (+ ticketTypes: track 2 extend karega)
router.get('/public/:slug', async (req, res) => {
  const parsed = tenantSlugSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'tenantSlug required' });
  if (!eventsEnabled()) return res.status(503).json({ error: 'events schema not merged yet' });
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { slug: parsed.data.tenantSlug, isActive: true },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) return res.status(404).json({ error: 'tenant not found' });
    const event = await prisma.communityEvent.findFirst({
      where: publicWhere(tenant.id, { slug: req.params.slug }),
      select: {
        ...publicSelect,
        _count: { select: { rsvps: true } },
      },
    });
    if (!event) return res.status(404).json({ error: 'event not found' });
    const now = new Date();
    // Paid ticket types (active + in sale window + stock) — Phase 44 Track 2
    let ticketTypes = [];
    try {
      const rows = await prisma.ticketType.findMany({
        where: { tenantId: tenant.id, eventId: event.id, isActive: true },
        orderBy: { price: 'asc' },
      });
      ticketTypes = rows
        .filter((t) => t.soldCount < t.quantity
          && (!t.saleStart || t.saleStart <= now)
          && (!t.saleEnd || t.saleEnd >= now))
        .map((t) => ({ id: t.id, name: t.name, price: String(t.price), remaining: t.quantity - t.soldCount }));
    } catch { /* ticketing not migrated yet */ }
    // Sponsors (active, tier order) — Phase 44 Track 6
    let sponsors = [];
    try {
      sponsors = await prisma.eventSponsor.findMany({
        where: { tenantId: tenant.id, eventId: event.id, isActive: true },
        select: { id: true, name: true, tier: true, logoUrl: true, website: true },
      });
      const order = { platinum: 0, gold: 1, silver: 2 };
      sponsors.sort((a, b) => (order[a.tier] ?? 3) - (order[b.tier] ?? 3));
    } catch { /* not migrated yet */ }
    // Agenda (sessions + speakers) — Phase 44 Track 7
    let agenda = { sessions: [], speakers: [] };
    try {
      const [sessions, speakers] = await Promise.all([
        prisma.eventSession.findMany({
          where: { tenantId: tenant.id, eventId: event.id },
          include: { speaker: { select: { id: true, name: true, title: true, company: true, photoUrl: true } } },
          orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }],
        }),
        prisma.eventSpeaker.findMany({
          where: { tenantId: tenant.id, eventId: event.id },
          select: { id: true, name: true, title: true, company: true, bio: true, photoUrl: true },
        }),
      ]);
      agenda = { sessions, speakers };
    } catch { /* not migrated yet */ }
    res.json({ tenant: { name: tenant.name, slug: tenant.slug }, event, ticketTypes, sponsors, agenda });
  } catch (err) {
    if (err && err.code === 'P2022') return res.status(503).json({ error: 'events schema not merged yet' });
    res.status(500).json({ error: 'failed to load event' });
  }
});

module.exports = router;
