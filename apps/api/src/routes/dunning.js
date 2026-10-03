// Phase 31 Track 3: Dunning routes — overdue reminder automation.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { processDunning, findOverdue, LEVEL_LABEL } = require('../lib/dunning');

const router = express.Router();

router.use(authenticate, requireTenantUser);

const FINANCE_ROLES = ['ceo', 'admin', 'super_admin', 'finance_officer'];
const canRun = requireRole(...FINANCE_ROLES);

// Overdue invoices with days-overdue + last reminder level
router.get('/overdue', canRun, async (req, res, next) => {
  try {
    const items = await findOverdue(req.user.tenantId);
    res.json({ items, levels: LEVEL_LABEL });
  } catch (e) { next(e); }
});

// Manual trigger — process reminders now
router.post('/run', canRun, async (req, res, next) => {
  try {
    const result = await processDunning(req.user.tenantId);
    await writeAudit({
      tenantId: req.user.tenantId, actorId: req.user.sub, action: 'dunning.run',
      entity: 'DunningLog',
      newValue: { processed: result.processed, sent: result.sent, skipped: result.skipped },
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => {});
    res.json({ processed: result.processed, sent: result.sent, skipped: result.skipped });
  } catch (e) { next(e); }
});

// Reminder history (latest first)
router.get('/logs', canRun, async (req, res, next) => {
  try {
    const logs = await prisma.dunningLog.findMany({
      where: { ...tenantFilter(req) },
      include: {
        invoice: {
          select: {
            id: true, number: true, amount: true, amountPaid: true, dueDate: true, status: true,
            member: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { sentAt: 'desc' },
      take: 200,
    });
    res.json({
      logs: logs.map((l) => ({
        id: l.id,
        sentAt: l.sentAt,
        level: l.level,
        levelLabel: LEVEL_LABEL[l.level] || `Level ${l.level}`,
        channel: l.channel,
        error: l.error || null,
        invoice: l.invoice
          ? {
              id: l.invoice.id,
              number: l.invoice.number,
              memberName: l.invoice.member?.name || '',
              memberEmail: l.invoice.member?.email || '',
              balance: Number(l.invoice.amount) - Number(l.invoice.amountPaid || 0),
              dueDate: l.invoice.dueDate,
              status: l.invoice.status,
            }
          : null,
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
