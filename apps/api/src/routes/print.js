// Phase 30 Track 4: Print-friendly invoices & receipts (data API).
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();
router.use(authenticate, requireTenantUser);

const brandingSelect = {
  id: true, name: true, slug: true, email: true, phone: true, address: true,
  tagline: true, primaryColor: true, logoPath: true,
};

// GET /api/print/invoice/:id — full invoice data for the print page
router.get('/invoice/:id', async (req, res, next) => {
  try {
    const where = { id: req.params.id, ...tenantFilter(req) };
    if (req.user.role === 'member') where.memberId = req.user.memberId;
    const invoice = await prisma.invoice.findFirst({
      where,
      include: {
        member: { select: { id: true, name: true, email: true, phone: true, companyName: true } },
        contract: { select: { id: true, startDate: true, endDate: true } },
        payments: { orderBy: { paidAt: 'desc' } },
        tenant: { select: brandingSelect },
      },
    });
    if (!invoice) return res.status(404).json({ error: { message: 'Invoice not found' } });
    const { logoPath, ...branding } = invoice.tenant || {};
    return res.json({
      invoice,
      branding: { ...branding, hasLogo: !!logoPath },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/print/receipt/:paymentId — payment receipt data
router.get('/receipt/:paymentId', async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.paymentId, ...tenantFilter(req) },
      include: {
        invoice: {
          include: {
            member: { select: { id: true, name: true, email: true, phone: true, companyName: true } },
          },
        },
        tenant: { select: brandingSelect },
      },
    });
    if (!payment) return res.status(404).json({ error: { message: 'Receipt not found' } });
    if (req.user.role === 'member' && payment.invoice.memberId !== req.user.memberId) {
      return res.status(404).json({ error: { message: 'Receipt not found' } });
    }
    const { logoPath, ...branding } = payment.tenant || {};
    return res.json({
      payment,
      invoice: payment.invoice,
      branding: { ...branding, hasLogo: !!logoPath },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
