// Multi-tenant helpers.
const tenantFilter = (req) => ({ tenantId: req.user.tenantId });

// Date-only "today" as a Date (midnight) for @db.Date comparisons.
// server.js pins process.env.TZ='UTC', so this is UTC midnight —
// consistent with how all @db.Date values are written.
function todayDateOnly() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Flip invoices to 'overdue' when past due date. Only touches invoices that
// are still open (unpaid/partial) — paid/cancelled stay untouched.
async function refreshOverdue(prisma, tenantId) {
  return prisma.invoice.updateMany({
    where: {
      tenantId,
      status: { in: ['unpaid', 'partial'] },
      dueDate: { lt: todayDateOnly() },
    },
    data: { status: 'overdue' },
  });
}

module.exports = { tenantFilter, todayDateOnly, refreshOverdue };
