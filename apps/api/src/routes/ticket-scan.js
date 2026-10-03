// Phase 44 Track 4: Event entry scanning.
// QR ticket validate karo (HMAC verify + status), entry mark karo, live stats do.
// MOUNT (coordinator server.js me ADD karein — additive):
//   app.use('/api/ticket-scan', require('./routes/ticket-scan'));
// NOTE: EventTicket model Track 3 ka hai — merge se pehle 503 guard fail-safe hai.
// Sign/verify lib: ../lib/ticketQr (Track 3 ki purchase flow bhi yahi use kare).
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { verifyTicketQr } = require('../lib/ticketQr');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const SCAN_ROLES = ['receptionist', 'ops', 'operations_manager', 'manager', 'admin', 'ceo', 'super_admin'];
const scanOnly = requireRole(...SCAN_ROLES);

// 503 guard — Track 3 ka fragment merge/migration se pehle endpoints safe fail hon.
function modelReady() {
  return prisma && typeof prisma.eventTicket?.findFirst === 'function';
}
function guard(req, res, next) {
  if (!modelReady()) return res.status(503).json({ error: 'event-tickets migration pending' });
  next();
}
router.use(guard);

function qrErrorMessage(reason) {
  switch (reason) {
    case 'expired': return 'Ticket QR code has expired.';
    case 'bad-signature': return 'Invalid ticket (signature mismatch).';
    case 'malformed':
    case 'missing': return 'Invalid ticket code format.';
    default: return 'Invalid ticket.';
  }
}

const validateSchema = z.object({
  code: z.string().min(8),
  eventId: z.string().cuid().optional(),
});

// POST /api/ticket-scan/validate {code, eventId?}
router.post('/validate', scanOnly, validateBody(validateSchema), async (req, res) => {
  const tf = tenantFilter(req);
  const { code, eventId } = req.body;

  const v = verifyTicketQr(code.trim());
  if (!v.ok) {
    return res.status(400).json({ ok: false, valid: false, reason: v.reason, message: qrErrorMessage(v.reason) });
  }
  const p = v.payload;

  // Cross-tenant ticket kabhi accept nahi hoga.
  if (p.tenantId !== tf.tenantId) {
    return res.status(422).json({ ok: false, valid: false, reason: 'wrong-tenant', message: 'Ticket belongs to another organization.' });
  }
  // Scanner ne event lock kiya ho aur ticket kisi aur event ka ho.
  if (eventId && p.eventId !== eventId) {
    return res.status(422).json({ ok: false, valid: false, reason: 'wrong-event', message: 'Ticket is for a different event.' });
  }

  const ticket = await prisma.eventTicket.findFirst({
    where: { id: p.ticketId, ...tf },
    include: { event: { select: { id: true, title: true, startsAt: true } }, ticketType: { select: { id: true, name: true } } },
  });
  if (!ticket) {
    return res.status(404).json({ ok: false, valid: false, reason: 'not-found', message: 'Ticket not found.' });
  }

  // Status checks — pehle reject, phir accept.
  if (ticket.status === 'used') {
    return res.status(409).json({
      ok: false, valid: false, reason: 'already-used', usedAt: ticket.usedAt,
      message: `Ticket already used${ticket.usedAt ? ` at ${new Date(ticket.usedAt).toLocaleString()}` : ''}.`,
      ticket: publicTicket(ticket),
    });
  }
  if (ticket.status === 'refunded') {
    return res.status(410).json({ ok: false, valid: false, reason: 'refunded', message: 'Ticket was refunded.', ticket: publicTicket(ticket) });
  }
  if (ticket.status === 'cancelled') {
    return res.status(410).json({ ok: false, valid: false, reason: 'cancelled', message: 'Ticket was cancelled.', ticket: publicTicket(ticket) });
  }
  if (ticket.status === 'transferred') {
    return res.status(409).json({ ok: false, valid: false, reason: 'transferred', message: 'Ticket was transferred — scan the new ticket code.', ticket: publicTicket(ticket) });
  }

  // Valid — entry mark karo.
  const updated = await prisma.eventTicket.update({
    where: { id: ticket.id },
    data: { status: 'used', usedAt: new Date() },
    include: { event: { select: { id: true, title: true, startsAt: true } }, ticketType: { select: { id: true, name: true } } },
  });

  await writeAudit(req, 'ticket.scan', 'EventTicket', updated.id, { eventId: updated.eventId, buyerName: updated.buyerName });

  return res.json({ ok: true, valid: true, message: 'Entry allowed.', ticket: publicTicket(updated) });
});

function publicTicket(t) {
  return {
    id: t.id,
    buyerName: t.buyerName,
    buyerEmail: t.buyerEmail,
    status: t.status,
    usedAt: t.usedAt,
    event: t.event,
    ticketType: t.ticketType,
  };
}

// GET /api/ticket-scan/stats/:eventId — live entry stats
router.get('/stats/:eventId', scanOnly, async (req, res) => {
  const tf = tenantFilter(req);
  const { eventId } = req.params;

  const event = await prisma.communityEvent.findFirst({ where: { id: eventId, ...tf }, select: { id: true, title: true } });
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const [total, scanned, refunded] = await Promise.all([
    prisma.eventTicket.count({ where: { eventId, ...tf, status: { in: ['valid', 'used'] } } }),
    prisma.eventTicket.count({ where: { eventId, ...tf, status: 'used' } }),
    prisma.eventTicket.count({ where: { eventId, ...tf, status: { in: ['refunded', 'cancelled'] } } }),
  ]);

  return res.json({
    event,
    total,
    scanned,
    remaining: total - scanned,
    refunded,
    entryRate: total ? Math.round((scanned / total) * 100) : 0,
  });
});

module.exports = router;
