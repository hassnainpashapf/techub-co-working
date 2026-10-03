// Phase 44 Track 5: Ticket Refunds & Transfers API.
// IMPORTANT: event-tickets.js Track 3 parallel me bana raha hai — usay touch nahi
// kiya. Yeh alag router hai jo '/api/tickets' par mount hoga (Express
// multi-router pattern, food-payments / event-checkins jaisa).
// MOUNT (coordinator server.js me ADD karein — event-tickets wali line ke paas):
//   app.use('/api/tickets', require('./routes/ticket-refunds'));
// SIDEBAR: nahi — tickets flow extend hai.
//
// REFUND POLICY (config): event ke start se 48 ghante pehle tak full refund
// automatically allowed hai; us ke baad sirf staff approval se (ceo/admin/manager).
// PAYMENT REFUND INTEGRATION NOTE (coordinator): POST /:id/refund par payment
// gateway (JazzCash/Easypaisa/stripe) ka asal refund abhi nahi lagaya — ticket
// status + soldCount update hote hain, aur `refund: { paymentRefundPending: true }`
// response me flag jata hai taake finance team gateway se manual/auto refund kar le.
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { signTicketQr } = require('../lib/ticketQr');
const { sendEmail } = require('../lib/mailer');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const staff = requireRole(...STAFF_ROLES);

// Event se kitne ghante pehle tak full (auto) refund allowed hai.
const REFUND_HOURS_CUTOFF = 48;

const hasTickets = () => Boolean(prisma.eventTicket);

// 503 guard — Track 3 ka schema merge na hua ho to
function ticketGuard(req, res, next) {
  if (!hasTickets()) {
    return res.status(503).json({ error: 'Tickets module not ready (migration pending)' });
  }
  return next();
}
router.use(ticketGuard);

async function findTicket(req, res) {
  const tf = tenantFilter(req);
  const ticket = await prisma.eventTicket.findFirst({
    where: { id: req.params.id, ...tf },
    include: { event: { select: { id: true, title: true, startsAt: true } } },
  });
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return null;
  }
  return ticket;
}

const refundSchema = z.object({
  reason: z.string().min(1).max(500),
});

// POST /api/tickets/:id/refund — staff: ticket refund karo
// { reason } -> status refunded + soldCount-- + paymentRefundPending flag
router.post('/:id/refund', staff, validateBody(refundSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ticket = await findTicket(req, res);
    if (!ticket) return;

    if (ticket.status === 'refunded') {
      return res.status(409).json({ error: 'Ticket already refunded' });
    }
    if (ticket.status === 'used') {
      return res.status(409).json({ error: 'Ticket already used — cannot refund' });
    }
    if (ticket.status === 'transferred') {
      return res.status(409).json({ error: 'Ticket was transferred — refund the new ticket instead' });
    }
    if (ticket.status !== 'valid') {
      return res.status(422).json({ error: `Ticket status '${ticket.status}' cannot be refunded` });
    }

    // Refund policy: event start se REFUND_HOURS_CUTOFF ghante pehle tak full refund.
    // Us ke baad sirf staff approval se — yeh endpoint staff-only hai, to policy
    // automatically satisfied hai; bas response me bataya jata hai.
    let autoFullRefund = true;
    if (ticket.event?.startsAt) {
      const hoursLeft = (new Date(ticket.event.startsAt).getTime() - Date.now()) / 3600000;
      autoFullRefund = hoursLeft >= REFUND_HOURS_CUTOFF;
      if (hoursLeft <= 0) {
        return res.status(422).json({ error: 'Event already started or past — cannot refund' });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.eventTicket.update({
        where: { id: ticket.id },
        data: {
          status: 'refunded',
          refundReason: req.body.reason,
          refundedAt: new Date(),
        },
      });
      // soldCount wapas ghatayo taake seat dobara bik sake (TicketType merge ho to)
      if (tx.ticketType && ticket.ticketTypeId) {
        await tx.ticketType.update({
          where: { id: ticket.ticketTypeId },
          data: { soldCount: { decrement: 1 } },
        });
      }
      return t;
    });

    await writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'ticket.refund',
      entity: 'EventTicket',
      entityId: ticket.id,
      newValue: { status: 'refunded', reason: req.body.reason },
    });

    return res.json({
      ok: true,
      ticket: { id: updated.id, status: updated.status, refundedAt: updated.refundedAt },
      policy: autoFullRefund ? 'full_refund' : 'staff_approved_refund',
      // Coordinator: payment gateway ka asal refund yahan wire hoga
      refund: { paymentRefundPending: true },
    });
  } catch (err) {
    return next(err);
  }
});

const transferSchema = z.object({
  toName: z.string().min(1).max(200),
  toEmail: z.string().email(),
});

// POST /api/tickets/:id/transfer — buyer khud apna ticket transfer kare
// { toName, toEmail } -> purana ticket 'transferred' (invalidate), naya ticket +
// naya QR code, TicketTransfer row, naye buyer ko email
router.post('/:id/transfer', validateBody(transferSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const ticket = await findTicket(req, res);
    if (!ticket) return;

    if (ticket.status !== 'valid') {
      return res.status(422).json({ error: `Ticket status '${ticket.status}' cannot be transferred` });
    }
    if (ticket.event?.startsAt && new Date(ticket.event.startsAt).getTime() <= Date.now()) {
      return res.status(422).json({ error: 'Event already started or past — cannot transfer' });
    }

    // Ownership: sirf ticket ka buyer (ya linked member, ya staff) transfer kar sakta hai
    const isStaff = STAFF_ROLES.includes(req.user.role);
    const myEmail = String(req.user.email || '').toLowerCase();
    const buyerEmail = String(ticket.buyerEmail || '').toLowerCase();
    const owns =
      isStaff ||
      (myEmail && buyerEmail && myEmail === buyerEmail) ||
      (req.user.memberId && ticket.memberId && req.user.memberId === ticket.memberId);
    if (!owns) {
      return res.status(403).json({ error: 'Only the ticket buyer can transfer this ticket' });
    }

    const toEmail = req.body.toEmail.toLowerCase();
    if (toEmail === buyerEmail) {
      return res.status(422).json({ error: 'Cannot transfer to the same email' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Purana ticket invalidate (purana QR code dead — scan status check karega)
      await tx.eventTicket.update({
        where: { id: ticket.id },
        data: { status: 'transferred' },
      });
      // 2. Naya ticket naye buyer ke liye
      const newTicket = await tx.eventTicket.create({
        data: {
          tenantId: tf.tenantId,
          eventId: ticket.eventId,
          ticketTypeId: ticket.ticketTypeId,
          buyerName: req.body.toName,
          buyerEmail: toEmail,
          buyerPhone: ticket.buyerPhone,
          memberId: null,
          code: 'pending',
          status: 'valid',
          price: ticket.price,
        },
      });
      // 3. Asal QR code naye ticket ke id se sign karo (Track 4 ka scan verify karega)
      const signedCode = signTicketQr({
        tenantId: tf.tenantId,
        eventId: ticket.eventId,
        ticketId: newTicket.id,
      });
      const finalTicket = await tx.eventTicket.update({
        where: { id: newTicket.id },
        data: { code: signedCode },
      });
      // 4. Transfer record
      const transfer = await tx.ticketTransfer.create({
        data: {
          tenantId: tf.tenantId,
          ticketId: ticket.id,
          fromEmail: ticket.buyerEmail || '',
          toName: req.body.toName,
          toEmail,
        },
      });
      return { newTicket: finalTicket, transfer };
    });

    await writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'ticket.transfer',
      entity: 'EventTicket',
      entityId: ticket.id,
      newValue: { toEmail, newTicketId: result.newTicket.id },
    });

    // Naye buyer ko email (QR code ke sath) — fail-safe
    try {
      await sendEmail(tf.tenantId, {
        to: toEmail,
        subject: `Your ticket for ${ticket.event?.title || 'the event'}`,
        html: `<p>Hi ${req.body.toName},</p><p>${ticket.buyerName || 'Someone'} transferred their ticket to you for <b>${ticket.event?.title || 'the event'}</b>.</p><p>Your ticket code:</p><pre style="font-size:16px;background:#f4f4f4;padding:12px;border-radius:8px;">${result.newTicket.code}</pre><p>Show this code at entry.</p>`,
        text: `Hi ${req.body.toName}, ticket transferred to you for ${ticket.event?.title || 'the event'}. Your ticket code: ${result.newTicket.code}`,
      });
    } catch (e) {
      // email fail ho to transfer fail nahi hota
    }

    return res.json({
      ok: true,
      oldTicket: { id: ticket.id, status: 'transferred' },
      newTicket: { id: result.newTicket.id, code: result.newTicket.code, buyerEmail: toEmail },
      transfer: { id: result.transfer.id, transferredAt: result.transfer.transferredAt },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
