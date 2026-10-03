// Phase 44 Track 3: Ticket Purchase Flow — public (no-auth, rate-limited).
// NOTE: "/api/tickets" pehle se support-tickets (routes/tickets.js) use karta
// hai — is liye MOUNT PATH "/api/event-tickets" hai, "/api/tickets" NAHI.
// Coordinator server.js me ADD karein (auth middleware se pehle ya baad —
// router me khud koi auth nahi lagaya, endpoints public hain):
//   app.use('/api/event-tickets', require('./routes/event-tickets'));
// Paths: POST /purchase, GET /mine
//
// PAYMENT INTEGRATION NOTE (coordinator): abhi purchase par status
// "valid" ban jata hai (payment assume = manual/cash). Jab payment gateway
// wiring ho (Phase 31 gateways.js / payment-intents), to purchase ko pehle
// status "payment_pending" me banao, payment webhook success par "valid" karo,
// fail par ticket + soldCount rollback. TODO marker neeche "PAYMENT-TODO".
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimit');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { isTicketTypeAvailable } = require('./ticket-types');

const router = express.Router();

// QR sign/verify: lib/ticketQr.js standard (Track 4 scan bhi yahi use karta hai).
// Duplicate local implementation hata di — payload { v, tenantId, eventId, ticketId, exp }.
const { signTicketQr, verifyTicketQr } = require('../lib/ticketQr');
const QR_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 saal

function modelsReady() {
  return prisma && typeof prisma.eventTicket?.create === 'function'
    && typeof prisma.ticketType?.update === 'function';
}

const purchaseLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many requests. Please try again later.' });

const purchaseSchema = z.object({
  tenantSlug: z.string().min(1),
  eventId: z.string().min(1),
  ticketTypeId: z.string().min(1),
  qty: z.number().int().min(1).max(20),
  buyerName: z.string().min(1).max(120),
  buyerEmail: z.string().email().max(160),
  buyerPhone: z.string().max(40).optional().nullable(),
  website: z.string().max(200).optional().nullable(), // honeypot
});

// ---------------------------------------------------------------------------
// POST /api/event-tickets/purchase — public ticket purchase.
router.post('/purchase', purchaseLimiter, validateBody(purchaseSchema), async (req, res, next) => {
  try {
    if (!modelsReady()) return res.status(503).json({ error: 'Ticketing not enabled yet' });
    if (req.body.website) return res.status(201).json({ ok: true, tickets: [] }); // honeypot → fake success
    const { tenantSlug, eventId, ticketTypeId, qty, buyerName, buyerEmail, buyerPhone } = req.body;

    const tenant = await prisma.tenant.findFirst({
      where: { slug: tenantSlug, isActive: true },
      select: { id: true, name: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Space not found' });

    const event = await prisma.communityEvent.findFirst({
      where: { id: eventId, tenantId: tenant.id },
      select: { id: true, title: true, status: true, startsAt: true, isPublic: true },
    });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status === 'cancelled') return res.status(410).json({ error: 'Event cancelled' });

    const avail = await isTicketTypeAvailable(tenant.id, ticketTypeId);
    if (!avail.ok) {
      const msg = { migration_pending: 'Ticketing not ready', not_found: 'Ticket type not found',
        inactive: 'Ticket sales closed', sale_window_closed: 'Sale window closed', sold_out: 'Sold out' }[avail.reason] || 'Unavailable';
      return res.status(avail.reason === 'sold_out' ? 409 : 400).json({ error: msg, remaining: avail.remaining ?? 0 });
    }
    const tt = avail.ticketType;
    if (tt.eventId !== eventId) return res.status(400).json({ error: 'Ticket type does not belong to this event' });
    const limit = tt.perOrderLimit || 10;
    if (qty > limit) return res.status(400).json({ error: `Max ${limit} tickets per order` });
    if (avail.remaining < qty) return res.status(409).json({ error: 'Not enough tickets left', remaining: avail.remaining });

    // Optional member link — buyer email se same tenant ka member.
    const member = await prisma.member.findFirst({
      where: { tenantId: tenant.id, email: buyerEmail },
      select: { id: true },
    }).catch(() => null);

    // PAYMENT-TODO: payment gateway wiring ke baad pehle status "payment_pending"
    // banao; webhook success par "valid", fail par rollback (ticket delete + soldCount--).
    // transaction me ticket create + soldCount++ (oversell impossible)
    const created = await prisma.$transaction(async (tx) => {
      const tickets = [];
      for (let i = 0; i < qty; i++) {
        const id = (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `t-${Date.now()}-${i}`);
        const t = await tx.eventTicket.create({
          data: {
            id,
            tenantId: tenant.id,
            eventId: event.id,
            ticketTypeId: tt.id,
            buyerName, buyerEmail, buyerPhone: buyerPhone || null,
            memberId: member?.id || null,
            code: signTicketQr({ tenantId: tenant.id, eventId: event.id, ticketId: id, ttlMs: QR_TTL_MS }),
            status: 'valid',
            price: tt.price,
          },
        });
        tickets.push(t);
      }
      await tx.ticketType.update({
        where: { id: tt.id },
        data: { soldCount: { increment: qty } },
      });
      return tickets;
    });

    // Purchase confirmation — templated ticket email (eventTicket template + QR), fail-safe.
    for (const t of created) {
      try {
        const { sendTicketConfirmation } = require('../lib/eventEmails');
        sendTicketConfirmation({ tenantId: tenant.id, ticket: t }).catch(() => {});
      } catch { /* email optional */ }
    }

    return res.status(201).json({
      ok: true,
      tickets: created.map((t) => ({ id: t.id, code: t.code, ticketType: tt.name, price: String(t.price), status: t.status })),
      event: { id: event.id, title: event.title },
    });
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/event-tickets/mine?email= — buyer ki tickets.
router.get('/mine', purchaseLimiter, async (req, res, next) => {
  try {
    if (!modelsReady()) return res.status(503).json({ error: 'Ticketing not enabled yet' });
    const { tenantSlug, email } = req.query;
    if (!tenantSlug || !email) return res.status(400).json({ error: 'tenantSlug and email required' });
    const tenant = await prisma.tenant.findFirst({
      where: { slug: String(tenantSlug), isActive: true },
      select: { id: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Space not found' });
    const tickets = await prisma.eventTicket.findMany({
      where: { tenantId: tenant.id, buyerEmail: String(email) },
      include: { event: { select: { id: true, title: true, startsAt: true } }, ticketType: { select: { name: true } } },
      orderBy: { purchasedAt: 'desc' },
      take: 50,
    });
    return res.json({
      tickets: tickets.map((t) => ({
        id: t.id, code: t.code, status: t.status, price: String(t.price),
        event: t.event, ticketType: t.ticketType?.name,
        purchasedAt: t.purchasedAt, usedAt: t.usedAt,
      })),
    });
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/event-tickets?eventId= — staff ticket listing (auth required).
router.get('/', authenticate, requireTenantUser, async (req, res, next) => {
  try {
    if (!modelsReady()) return res.status(503).json({ error: 'Ticketing not enabled yet' });
    const tf = tenantFilter(req);
    const where = { ...tf };
    if (req.query.eventId) where.eventId = String(req.query.eventId);
    if (req.query.status) where.status = String(req.query.status);
    const tickets = await prisma.eventTicket.findMany({
      where,
      include: { event: { select: { id: true, title: true } }, ticketType: { select: { name: true } } },
      orderBy: { purchasedAt: 'desc' },
      take: 100,
    });
    return res.json({ tickets });
  } catch (err) { return next(err); }
});

module.exports = router;
module.exports.signTicketQr = signTicketQr;
module.exports.verifyTicketQr = verifyTicketQr;
