// Phase 31 Track 5: Payment Gateway Framework.
// GET /api/gateways            — available gateways (JWT)
// POST /api/gateways/create    — payment link/instructions (JWT, member: own invoices only)
// POST /api/gateways/webhook/:gateway — PUBLIC, signature-verified, marks invoice paid
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { getGateway, getAvailableGateways } = require('../lib/gateways');

const router = express.Router();

// ---------------------------------------------------------------------------
// Public webhook — MUST come before the JWT middleware below.
// ---------------------------------------------------------------------------
router.post('/webhook/:gateway', async (req, res, next) => {
  try {
    const gw = getGateway(req.params.gateway);
    if (!gw) return res.status(404).json({ error: { message: 'Unknown gateway.' } });

    // Byte-exact raw body preferred (needs express.json verify hook in server.js
    // for real providers); fallback to canonical JSON of the parsed body.
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const result = await gw.verifyWebhook(req.body || {}, rawBody, req.headers || {});
    if (!result || !result.valid) {
      return res.status(401).json({ error: { message: 'Invalid webhook signature.' } });
    }

    // Match the pending online payment by gateway reference
    const where = { gateway: gw.name, status: 'pending' };
    if (result.gatewayRef) where.gatewayRef = result.gatewayRef;
    let onlinePayment = result.gatewayRef
      ? await prisma.onlinePayment.findFirst({ where, include: { invoice: true } })
      : null;

    if (!onlinePayment) {
      return res.status(404).json({ error: { message: 'No matching pending payment.' } });
    }

    if (result.status === 'paid') {
      const payAmount = result.amount != null ? Number(result.amount) : Number(onlinePayment.amount);
      const invoice = onlinePayment.invoice;
      const newAmountPaid = Number(invoice.amountPaid) + payAmount;
      await prisma.$transaction([
        prisma.onlinePayment.update({
          where: { id: onlinePayment.id },
          data: { status: 'paid', gatewayRef: result.gatewayRef || onlinePayment.gatewayRef },
        }),
        prisma.payment.create({
          data: {
            tenantId: onlinePayment.tenantId,
            invoiceId: invoice.id,
            amount: payAmount,
            method: gw.name,
            note: `Online payment via ${gw.displayName}${result.gatewayRef ? ` (ref ${result.gatewayRef})` : ''}`,
          },
        }),
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: newAmountPaid,
            status: newAmountPaid >= Number(invoice.amount) ? 'paid' : 'partial',
          },
        }),
      ]);
      await writeAudit({
        tenantId: onlinePayment.tenantId,
        actorId: null,
        action: 'payment.online_received',
        entity: 'OnlinePayment',
        entityId: onlinePayment.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res.json({ ok: true, status: 'paid' });
    }

    // Gateway reported failure
    await prisma.onlinePayment.update({ where: { id: onlinePayment.id }, data: { status: 'failed' } });
    return res.json({ ok: true, status: 'failed' });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------
router.use(authenticate, requireTenantUser);

// GET /api/gateways — list available gateways
router.get('/', async (req, res, next) => {
  try {
    return res.json({ gateways: getAvailableGateways() });
  } catch (err) {
    return next(err);
  }
});

const createSchema = z.object({
  invoiceId: z.string().min(1),
  gateway: z.string().min(1),
});

// POST /api/gateways/create — {invoiceId, gateway} → link/instructions
router.post('/create', validateBody(createSchema), async (req, res, next) => {
  try {
    const { invoiceId, gateway: gatewayName } = req.body;
    const gw = getGateway(gatewayName);
    if (!gw) return res.status(404).json({ error: { message: 'Unknown gateway.' } });

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, ...tenantFilter(req) },
      include: { member: { select: { id: true, email: true, name: true } } },
    });
    if (!invoice) return res.status(404).json({ error: { message: 'Invoice not found.' } });

    // Members may only pay their own invoices
    if (req.user.role === 'member' && req.user.memberId && invoice.memberId !== req.user.memberId) {
      return res.status(403).json({ error: { message: 'You can only pay your own invoices.' } });
    }
    if (String(invoice.status).toLowerCase() === 'paid') {
      return res.status(400).json({ error: { message: 'Invoice is already paid.' } });
    }

    const balance = Math.max(Number(invoice.amount) - Number(invoice.amountPaid), 0);
    if (balance <= 0) {
      return res.status(400).json({ error: { message: 'Nothing left to pay on this invoice.' } });
    }

    const link = await gw.createPaymentLink({
      amount: balance,
      invoiceId: invoice.id,
      memberEmail: invoice.member && invoice.member.email,
      tenantId: invoice.tenantId,
      returnUrl: `${process.env.WEB_URL || ''}/billing`,
    });
    if (!link || link.configured === false) {
      return res.status(400).json({ error: { message: (link && link.reason) || 'Gateway not configured.' } });
    }

    const onlinePayment = await prisma.onlinePayment.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        gateway: gw.name,
        amount: balance,
        status: 'pending',
        gatewayRef: link.reference || null,
      },
    });

    await writeAudit({
      tenantId: invoice.tenantId,
      actorId: req.user.sub,
      action: 'payment.online_initiated',
      entity: 'OnlinePayment',
      entityId: onlinePayment.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      onlinePayment: { id: onlinePayment.id, gateway: gw.name, amount: balance, status: 'pending' },
      paymentUrl: link.paymentUrl || null,
      instructions: link.instructions || null,
      reference: link.reference || null,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
