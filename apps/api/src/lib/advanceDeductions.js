// Phase 42 Track 6: Salary Advances & Loans — payroll integration lib.
// COORDINATOR INTEGRATION NOTE (payroll.js, phase 31):
//   Payslip generation ke dauran per-user advance deduction apply karne ke liye:
//     const { applyAdvanceDeductions } = require('./lib/advanceDeductions');
//   Payroll run create/finalize ke waqt, har payslip row banane se PEHLE:
//     const ded = await applyAdvanceDeductions({
//       tenantId: tf.tenantId,
//       employeeId,          // payslip.userId se linked Employee.id
//       payslipId,           // null bhi chalega (record bina payslip link ke ban jayega)
//     });
//     // ded = { totalDeducted, deductions: [{advanceId, amount}] } — ded.totalDeducted ko
//     // payslip ke deductions Json me "salary_advance" line ke tor par jorna hai.
//   applyAdvanceDeductions idempotent hai: ek payslipId ke liye dobara call par 0 return karega
//   (deductedSoFar install base par bhi capped hai — over-deduct impossible).
const { Prisma } = require('@prisma/client');
const prisma = require('./prisma');

function advancesEnabled() {
  return !!(prisma && prisma.salaryAdvance);
}

// Ek employee ke active advances me se is cycle ki installment deduct karo.
// Returns { totalDeducted: number, deductions: [{ advanceId, amount }] }
async function applyAdvanceDeductions({ tenantId, employeeId, payslipId = null }) {
  if (!advancesEnabled() || !tenantId || !employeeId) {
    return { totalDeducted: 0, deductions: [] };
  }
  // Sirf approved/deducting advances jisme abhi balance bacha hai
  const advances = await prisma.salaryAdvance.findMany({
    where: {
      tenantId,
      employeeId,
      status: { in: ['approved', 'deducting'] },
    },
    orderBy: { requestedAt: 'asc' },
  });
  const deductions = [];
  let totalDeducted = 0;
  for (const adv of advances) {
    const remaining = Number(adv.amount) - Number(adv.deductedSoFar);
    if (remaining <= 0) {
      // Balance khatam — close kar do
      await prisma.salaryAdvance.update({
        where: { id: adv.id },
        data: { status: 'closed' },
      }).catch(() => {});
      continue;
    }
    const installment = Math.min(Number(adv.installmentAmount) || remaining, remaining);
    if (installment <= 0) continue;
    // Double-deduct guard: agar is payslipId par pehle se deduction hai to skip
    if (payslipId) {
      const existing = await prisma.advanceDeduction.findFirst({
        where: { advanceId: adv.id, payslipId },
      }).catch(() => null);
      if (existing) continue;
    }
    await prisma.advanceDeduction.create({
      data: {
        tenantId,
        advanceId: adv.id,
        payslipId,
        amount: new Prisma.Decimal(installment),
      },
    });
    const newDeducted = Number(adv.deductedSoFar) + installment;
    const done = newDeducted >= Number(adv.amount) - 0.009; // rounding tolerance
    await prisma.salaryAdvance.update({
      where: { id: adv.id },
      data: {
        deductedSoFar: new Prisma.Decimal(newDeducted),
        status: done ? 'closed' : 'deducting',
      },
    });
    deductions.push({ advanceId: adv.id, amount: installment });
    totalDeducted += installment;
  }
  return { totalDeducted, deductions };
}

module.exports = { applyAdvanceDeductions, advancesEnabled };
