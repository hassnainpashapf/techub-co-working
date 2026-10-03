// Phase 44 Track 2: Ticket Types for Events.
// MOUNT (coordinator server.js me ADD karein):
//   app.use('/api/ticket-types', require('./routes/ticket-types'));
//
// Frontend integration (coordinator): events detail/edit page me "Tickets" tab
// jorna — ticket type CRUD + availability status yahan se:
//   import TicketTypesTab from '@/components/TicketTypesTab';
//   <TicketTypesTab eventId={event.id} />   // component events page ke sath ho
//
// Availability helper (Track 3 purchase flow ke liye):
//   const { isTicketTypeAvailable } = require('./ticket-types');
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
router.use(requireRole(...STAFF));

// 503 guard — fragment merge/migration se pehle endpoints safe fail hon.
function modelReady() {
  return prisma && typeof prisma.ticketType?.findMany === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'ticket-types migration pending' });
  next();
}
router.use(guard);

async function tenantEvent(req, id) {
  const tf = tenantFilter(req);
  return prisma.communityEvent.findFirst({ where: { id, ...tf } });
}

function availabilityOf(tt) {
  const now = new Date();
  const inWindow =
    (!tt.saleStart || new Date(tt.saleStart) <= now) &&
    (!tt.saleEnd || new Date(tt.saleEnd) >= now);
  const hasStock = (tt.soldCount || 0) < tt.quantity;
  return { available: !!(tt.isActive && inWindow && hasStock), inWindow, hasStock, remaining: tt.quantity - (tt.soldCount || 0) };
}

// Exported helper — Track 3 (purchase) isay use kare:
//   const { isTicketTypeAvailable } = require('./ticket-types');
async function isTicketTypeAvailable(tenantId, ticketTypeId) {
  if (!modelReady()) return { ok: false, reason: 'migration_pending' };
  const tt = await prisma.ticketType.findFirst({ where: { id: ticketTypeId, tenantId } });
  if (!tt) return { ok: false, reason: 'not_found' };
  const a = availabilityOf(tt);
  if (!a.available) {
    const reason = !tt.isActive ? 'inactive' : !a.inWindow ? 'sale_window_closed' : 'sold_out';
    return { ok: false, reason, ticketType: tt, remaining: a.remaining };
  }
  return { ok: true, ticketType: tt, remaining: a.remaining };
}

const ticketTypeSchema = z.object({
  name: z.string().min(1).max(120),
  price: z.coerce.number().min(0).max(100000000),
  quantity: z.coerce.number().int().min(1).max(1000000),
  saleStart: z.coerce.date().optional().nullable(),
  saleEnd: z.coerce.date().optional().nullable(),
  isActive: z.boolean().optional(),
  perOrderLimit: z.coerce.number().int().min(1).max(1000).optional().nullable(),
});

// GET /api/ticket-types?eventId= — event ke ticket types (+ availability)
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.eventId) {
      const ev = await tenantEvent(req, req.query.eventId);
      if (!ev) return res.status(404).json({ error: 'event_not_found' });
      where.eventId = ev.id;
    }
    const types = await prisma.ticketType.findMany({ where, orderBy: { price: 'asc' } });
    res.json({ ticketTypes: types.map((t) => ({ ...t, price: Number(t.price), ...availabilityOf(t) })) });
  } catch (e) { next(e); }
});

// GET /api/ticket-types/:id
router.get('/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const tt = await prisma.ticketType.findFirst({ where: { id: req.params.id, ...tf } });
    if (!tt) return res.status(404).json({ error: 'not_found' });
    res.json({ ticketType: { ...tt, price: Number(tt.price), ...availabilityOf(tt) } });
  } catch (e) { next(e); }
});

// POST /api/ticket-types — naya ticket type (eventId body me)
router.post('/', validateBody(ticketTypeSchema.extend({ eventId: z.string().min(1) })), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ev = await tenantEvent(req, req.body.eventId);
    if (!ev) return res.status(404).json({ error: 'event_not_found' });
    const tt = await prisma.ticketType.create({
      data: { ...tf, eventId: ev.id, name: req.body.name, price: req.body.price,
        quantity: req.body.quantity, saleStart: req.body.saleStart ?? null,
        saleEnd: req.body.saleEnd ?? null, isActive: req.body.isActive ?? true,
        perOrderLimit: req.body.perOrderLimit ?? null },
    });
    await writeAudit(req, 'ticket-type.create', 'TicketType', tt.id);
    res.status(201).json({ ticketType: { ...tt, price: Number(tt.price) } });
  } catch (e) { next(e); }
});

// PATCH /api/ticket-types/:id
router.patch('/:id', validateBody(ticketTypeSchema.partial()), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.ticketType.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    // sold tickets se kam quantity allow nahi
    if (req.body.quantity != null && req.body.quantity < existing.soldCount) {
      return res.status(422).json({ error: 'quantity_below_sold', sold: existing.soldCount });
    }
    const tt = await prisma.ticketType.update({ where: { id: existing.id }, data: req.body });
    await writeAudit(req, 'ticket-type.update', 'TicketType', tt.id);
    res.json({ ticketType: { ...tt, price: Number(tt.price) } });
  } catch (e) { next(e); }
});

// PATCH /api/ticket-types/:id/active — quick toggle
router.patch('/:id/active', validateBody(z.object({ isActive: z.boolean() })), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.ticketType.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const tt = await prisma.ticketType.update({ where: { id: existing.id }, data: { isActive: req.body.isActive } });
    await writeAudit(req, 'ticket-type.active', 'TicketType', tt.id);
    res.json({ ticketType: { ...tt, price: Number(tt.price), ...availabilityOf(tt) } });
  } catch (e) { next(e); }
});

// DELETE /api/ticket-types/:id — sirf jab kuch bika na ho
router.delete('/:id', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const existing = await prisma.ticketType.findFirst({ where: { id: req.params.id, ...tf } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if ((existing.soldCount || 0) > 0) return res.status(422).json({ error: 'tickets_already_sold', sold: existing.soldCount });
    await prisma.ticketType.delete({ where: { id: existing.id } });
    await writeAudit(req, 'ticket-type.delete', 'TicketType', existing.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.isTicketTypeAvailable = isTicketTypeAvailable;
module.exports.availabilityOf = availabilityOf;
