// Phase 31 Track 10/10: AR Aging Report — outstanding receivables by member,
// bucketed by days past dueDate: current (0-30), 31-60, 61-90, 90+.
const express = require('express');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { tenantFilter } = require('../lib/tenant');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin', 'super_admin', 'finance_officer'));

function bucket(daysPastDue) {
  if (daysPastDue <= 30) return 'current';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  return 'd90plus';
}

router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Only open invoices count toward AR (paid/cancelled excluded).
    const invoices = await prisma.invoice.findMany({
      where: { ...tf, status: { in: ['unpaid', 'partial', 'overdue'] } },
      select: {
        id: true,
        number: true,
        dueDate: true,
        amount: true,
        amountPaid: true,
        memberId: true,
        member: { select: { id: true, name: true } },
      },
    });

    const rows = new Map(); // memberId -> bucket totals
    const totals = { current: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };

    for (const inv of invoices) {
      const outstanding = Number(inv.amount) - Number(inv.amountPaid);
      if (outstanding <= 0) continue;
      const due = new Date(inv.dueDate);
      const daysPastDue = Math.floor((today - due) / 86400000);
      const b = bucket(daysPastDue);

      let row = rows.get(inv.memberId);
      if (!row) {
        row = {
          memberId: inv.memberId,
          memberName: inv.member ? inv.member.name : '—',
          current: 0,
          d31_60: 0,
          d61_90: 0,
          d90plus: 0,
          total: 0,
        };
        rows.set(inv.memberId, row);
      }
      row[b] += outstanding;
      row.total += outstanding;
      totals[b] += outstanding;
      totals.total += outstanding;
    }

    const list = [...rows.values()].sort((a, b) => b.total - a.total);
    return res.json({ rows: list, totals });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
