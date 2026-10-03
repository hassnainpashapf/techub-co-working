// Phase 44 Track 6: Event Sponsors — CRUD per event.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/sponsors', require('./routes/sponsors'));
// SIDEBAR (coordinator Sidebar.js me ADD karein — naya "Sponsors" tab events
//   detail page me hoga, link zaroori nahi; direct page optional:
//   Events section → /events se sponsor manage):
// INTEGRATION NOTES (coordinator ke liye):
//   1) Public event page (Track 1: apps/web/app/events/[slug]/page.js) me
//      sponsors section jorna: GET /api/events/public/:slug me Track 1 ya
//      coordinator `include: { sponsors: { where: { isActive: true } } }`
//      jode, phir tier order (platinum > gold > silver) me logo grid dikhaye.
//   2) Staff event detail page (apps/web/app/(app)/events/page.js) me
//      "Sponsors" tab jorna: GET /api/sponsors?eventId=<id> se list,
//      POST/PUT/DELETE /api/sponsors se manage. Component snippet:
//      <SponsorsTab eventId={event.id} /> — coordinator banaye ya tab ke
//      andar yehi endpoints use kare (table: name, tier pill, amount, active toggle).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF = ['manager', 'admin', 'ceo', 'super_admin'];
const staffOnly = requireRole(...STAFF);

// 503 guard — fragment merge/migration se pehle endpoints safe fail hon.
function modelReady() {
  return prisma && typeof prisma.eventSponsor?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'sponsors migration pending' });
  next();
}
router.use(guard);

const TIERS = ['platinum', 'gold', 'silver'];

const sponsorBody = z.object({
  eventId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  tier: z.enum(TIERS).default('silver'),
  logoUrl: z.string().trim().max(500).optional().or(z.literal('')),
  website: z.string().trim().max(500).optional().or(z.literal('')),
  amount: z.coerce.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

async function tenantEvent(req, id) {
  const tf = tenantFilter(req);
  return prisma.communityEvent.findFirst({ where: { id, ...tf } });
}

// GET /api/sponsors?eventId= — event ke sponsors (tier order me), sab logged-in staff dekh sakte hain
router.get('/', async (req, res) => {
  const tf = tenantFilter(req);
  const where = { ...tf };
  if (req.query.eventId) {
    const ev = await tenantEvent(req, String(req.query.eventId));
    if (!ev) return res.status(404).json({ error: 'event not found' });
    where.eventId = ev.id;
  }
  const sponsors = await prisma.eventSponsor.findMany({
    where,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  });
  const order = { platinum: 0, gold: 1, silver: 2 };
  sponsors.sort((a, b) => (order[a.tier] ?? 3) - (order[b.tier] ?? 3));
  res.json({ sponsors });
});

// GET /api/sponsors/:id — single sponsor
router.get('/:id', async (req, res) => {
  const tf = tenantFilter(req);
  const sponsor = await prisma.eventSponsor.findFirst({ where: { id: req.params.id, ...tf } });
  if (!sponsor) return res.status(404).json({ error: 'sponsor not found' });
  res.json({ sponsor });
});

// POST /api/sponsors — naya sponsor (staff)
router.post('/', staffOnly, validateBody(sponsorBody), async (req, res) => {
  const tf = tenantFilter(req);
  const ev = await tenantEvent(req, req.body.eventId);
  if (!ev) return res.status(404).json({ error: 'event not found' });
  const data = {
    tenantId: tf.tenantId,
    eventId: ev.id,
    name: req.body.name,
    tier: req.body.tier || 'silver',
    logoUrl: req.body.logoUrl || null,
    website: req.body.website || null,
    amount: req.body.amount != null ? req.body.amount : null,
    isActive: req.body.isActive !== false,
  };
  const sponsor = await prisma.eventSponsor.create({ data });
  await writeAudit(req, { action: 'sponsor.create', entity: 'EventSponsor', entityId: sponsor.id, meta: { eventId: ev.id, tier: sponsor.tier } });
  res.status(201).json({ sponsor });
});

// PUT /api/sponsors/:id — edit (staff)
router.put('/:id', staffOnly, validateBody(sponsorBody.partial()), async (req, res) => {
  const tf = tenantFilter(req);
  const existing = await prisma.eventSponsor.findFirst({ where: { id: req.params.id, ...tf } });
  if (!existing) return res.status(404).json({ error: 'sponsor not found' });
  const sponsor = await prisma.eventSponsor.update({
    where: { id: existing.id },
    data: {
      name: req.body.name,
      tier: req.body.tier,
      logoUrl: req.body.logoUrl === '' ? null : req.body.logoUrl,
      website: req.body.website === '' ? null : req.body.website,
      amount: req.body.amount != null ? req.body.amount : undefined,
      isActive: req.body.isActive,
    },
  });
  await writeAudit(req, { action: 'sponsor.update', entity: 'EventSponsor', entityId: sponsor.id });
  res.json({ sponsor });
});

// DELETE /api/sponsors/:id — delete (staff)
router.delete('/:id', staffOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const existing = await prisma.eventSponsor.findFirst({ where: { id: req.params.id, ...tf } });
  if (!existing) return res.status(404).json({ error: 'sponsor not found' });
  await prisma.eventSponsor.delete({ where: { id: existing.id } });
  await writeAudit(req, { action: 'sponsor.delete', entity: 'EventSponsor', entityId: existing.id });
  res.json({ ok: true });
});

// PATCH /api/sponsors/:id/toggle — active toggle (staff)
router.patch('/:id/toggle', staffOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const existing = await prisma.eventSponsor.findFirst({ where: { id: req.params.id, ...tf } });
  if (!existing) return res.status(404).json({ error: 'sponsor not found' });
  const sponsor = await prisma.eventSponsor.update({
    where: { id: existing.id },
    data: { isActive: !existing.isActive },
  });
  await writeAudit(req, { action: 'sponsor.toggle', entity: 'EventSponsor', entityId: sponsor.id });
  res.json({ sponsor });
});

module.exports = router;
