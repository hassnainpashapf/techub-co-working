// Phase 31: Member credit limits — balance vs limit checks.
const prisma = require('./prisma');

// Total unpaid dues for a member: sum(amount - amountPaid) over open invoices.
// Open = status in (unpaid, partial, overdue). Cancelled/paid invoices don't count.
async function getMemberBalance(tenantId, memberId) {
  const agg = await prisma.invoice.aggregate({
    where: {
      tenantId,
      memberId,
      status: { in: ['unpaid', 'partial', 'overdue'] },
    },
    _sum: { amount: true, amountPaid: true },
  });
  const total = Number(agg._sum.amount || 0);
  const paid = Number(agg._sum.amountPaid || 0);
  return Math.max(0, total - paid);
}

// Returns { limit, balance, exceeded }. limit null => unlimited (never exceeded).
async function checkCreditLimit(tenantId, memberId) {
  let member;
  try {
    member = await prisma.member.findFirst({
      where: { id: memberId, tenantId },
      select: { id: true, creditLimit: true },
    });
  } catch (err) {
    // credit_limit column not migrated yet — treat as unlimited, never block.
    if (/credit_limit|creditLimit/i.test(String((err && err.message) || err))) {
      const balance = await getMemberBalance(tenantId, memberId).catch(() => 0);
      return { limit: null, balance, exceeded: false };
    }
    throw err;
  }
  if (!member) {
    const err = new Error('Member not found');
    err.status = 400;
    throw err;
  }
  const balance = await getMemberBalance(tenantId, memberId);
  const limit = member.creditLimit == null ? null : Number(member.creditLimit);
  const exceeded = limit != null && balance > limit;
  return { limit, balance, exceeded };
}

module.exports = { getMemberBalance, checkCreditLimit };
