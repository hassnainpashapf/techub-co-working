const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter, todayDateOnly, refreshOverdue } = require('../lib/tenant');
const { createNotification, sendMessage } = require('../lib/notify');

const router = express.Router();

router.use(authenticate, requireTenantUser);

// Inbox: notifications addressed to me directly, or to my role.
router.get('/', async (req, res, next) => {
  try {
    const items = await prisma.notification.findMany({
      where: {
        tenantId: req.user.tenantId,
        OR: [{ userId: req.user.sub }, { role: req.user.role }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const unreadCount = items.filter((n) => !n.isRead).length;
    return res.json({ items, unreadCount });
  } catch (err) {
    return next(err);
  }
});

// Mark read: only notifications targeted at me personally or at my role.
router.patch('/:id/read', async (req, res, next) => {
  try {
    const existing = await prisma.notification.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
        OR: [{ userId: req.user.sub }, { role: req.user.role }],
      },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Notification not found' } });
    }
    const notification = await prisma.notification.update({
      where: { id: existing.id },
      data: { isRead: true },
    });
    return res.json({ notification });
  } catch (err) {
    return next(err);
  }
});

// Generate rent-due and contract-expiry reminders (idempotent-ish via dedupe).
router.post('/generate', requireRole('ceo', 'admin', 'finance_officer'), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const today = todayDateOnly();
    await refreshOverdue(prisma, req.user.tenantId);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // --- rent due reminders ------------------------------------------------
    const overdueInvoices = await prisma.invoice.findMany({
      where: { ...tf, status: 'overdue' },
      include: { member: { select: { id: true, name: true, phone: true } } },
    });

    let rentDue = 0;
    for (const inv of overdueInvoices) {
      const remaining = Number(inv.amount) - Number(inv.amountPaid);
      // Dedupe: skip if a rent_due notification for this invoice number was
      // created in the last 7 days.
      const recent = await prisma.notification.findFirst({
        where: {
          tenantId: tf.tenantId,
          type: 'rent_due',
          message: { contains: inv.number },
          createdAt: { gte: sevenDaysAgo },
        },
      });
      if (recent) continue;

      const message = `Rent due: ${inv.member.name} — invoice ${inv.number} Rs ${remaining} overdue since ${inv.dueDate.toISOString().slice(0, 10)}`;

      for (const role of ['finance_officer', 'admin', 'ceo']) {
        await createNotification(prisma, {
          tenantId: tf.tenantId,
          role,
          type: 'rent_due',
          message,
        });
      }

      // Also ping the member's own login if they have one.
      const memberUser = await prisma.user.findFirst({
        where: { tenantId: tf.tenantId, memberId: inv.memberId },
      });
      if (memberUser) {
        await createNotification(prisma, {
          tenantId: tf.tenantId,
          userId: memberUser.id,
          type: 'rent_due',
          message,
        });
      }

      // Console fallback until a WhatsApp provider is configured.
      if (inv.member.phone) {
        await sendMessage({
          to: inv.member.phone,
          channel: 'whatsapp',
          message,
        });
      }
      rentDue += 1;
    }

    // --- contract expiry reminders ---------------------------------------
    const in15Days = new Date(today);
    in15Days.setDate(in15Days.getDate() + 15);
    const expiring = await prisma.contract.findMany({
      where: { ...tf, status: 'active', endDate: { lte: in15Days } },
      include: {
        member: { select: { id: true, name: true, phone: true } },
        unit: { select: { code: true } },
      },
    });

    let contractExpiry = 0;
    for (const contract of expiring) {
      const message = `Contract expiring: ${contract.member.name} (${contract.unit.code}) ends ${contract.endDate.toISOString().slice(0, 10)}`;
      for (const role of ['manager', 'admin', 'ceo']) {
        await createNotification(prisma, {
          tenantId: tf.tenantId,
          role,
          type: 'contract_expiry',
          message,
        });
      }
      const memberUser = await prisma.user.findFirst({
        where: { tenantId: tf.tenantId, memberId: contract.memberId },
      });
      if (memberUser) {
        await createNotification(prisma, {
          tenantId: tf.tenantId,
          userId: memberUser.id,
          type: 'contract_expiry',
          message,
        });
      }
      if (contract.member.phone) {
        await sendMessage({ to: contract.member.phone, channel: 'whatsapp', message });
      }
      contractExpiry += 1;
    }

    return res.status(201).json({ rentDue, contractExpiry });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
