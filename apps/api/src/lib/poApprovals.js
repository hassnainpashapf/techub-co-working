// Phase 41 Track 6: Procurement Approval Workflow — multi-level approval engine.
// Multi-level PO approvals: level 1 = manager/admin, level 2 = ceo (total > 50000).
// Level order enforce hota hai — level 2 tabhi approve kar sakta hai jab level 1 ho chuka ho.

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

// Notification adapter — lib/notify.js ka createNotification(prisma, {tenantId, role/userId, type, message})
async function notifyOne({ tenantId, role = null, userId = null, type, message }) {
  const { createNotification } = require('./notify');
  try {
    await createNotification(prisma, { tenantId, role, userId, type, message });
  } catch {}
}
async function notifyRoles(tenantId, roles, type, message) {
  for (const role of roles) await notifyOne({ tenantId, role, type, message });
}

// Config: kitne amount se upar level 2 (ceo) chahiye
const LEVEL2_THRESHOLD = 50000;

// Kaun se role kaun sa level approve kar sakte hain
const LEVEL1_ROLES = ['manager', 'admin', 'super_admin'];
const LEVEL2_ROLES = ['ceo', 'super_admin'];

function approvalEnabled() {
  return !!(prisma && prisma.purchaseOrder && prisma.pOApproval);
}

// total (Decimal/string/number) → required levels array: [1] ya [1, 2]
function getRequiredLevels(total) {
  const t = Number(total || 0);
  return t > LEVEL2_THRESHOLD ? [1, 2] : [1];
}

function userEligibleLevel(user) {
  const role = user && user.role;
  if (LEVEL2_ROLES.includes(role)) return [1, 2]; // ceo/super_admin dono levels
  if (LEVEL1_ROLES.includes(role)) return [1];
  return [];
}

function toNum(d) {
  return Number((d && d.toString && d.toString()) || d || 0);
}

async function notifySafe(fn) {
  try { await fn(); } catch (e) { /* notifications kabhi workflow nahi rokti */ }
}

// PO ko approval ke liye submit karo — status draft/pending_approval
async function submitForApproval({ tenantId, poId, actorId }) {
  const tf = { tenantId };
  const po = await prisma.purchaseOrder.findFirst({ where: { id: poId, tenantId } });
  if (!po) { const e = new Error('PO not found'); e.status = 404; throw e; }
  if (po.status !== 'draft') { const e = new Error('Sirf draft PO submit ho sakta hai'); e.status = 400; throw e; }

  const levels = getRequiredLevels(toNum(po.total));
  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: 'pending_approval', requestedBy: actorId || po.requestedBy },
  });

  // Level 1 approvers (manager/admin) ko in-app notification
  await notifySafe(async () => {
    await notifyRoles(tenantId, ['manager', 'admin', 'ceo'], 'po.approval_needed',
      `PO ${po.number} (${levels.length}-level approval) submit hua hai`);
  });

  return { ok: true, status: 'pending_approval', requiredLevels: levels };
}

// Next pending level batao (ya null agar sab approve ho chuke)
async function getNextPendingLevel({ tenantId, poId }) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId },
    include: { approvals: true },
  });
  if (!po) { const e = new Error('PO not found'); e.status = 404; throw e; }
  const levels = getRequiredLevels(toNum(po.total));
  const approvedLevels = new Set(
    (po.approvals || []).filter((a) => a.decision === 'approved').map((a) => a.level)
  );
  const next = levels.find((l) => !approvedLevels.has(l)) ?? null;
  return { po, levels, approvedLevels: [...approvedLevels], nextPendingLevel: next };
}

// Approve — level order enforce: sirf next pending level approve ho sakta hai.
async function approve({ tenantId, poId, user, note }) {
  const { po, levels, nextPendingLevel } = await getNextPendingLevel({ tenantId, poId });
  if (po.status !== 'pending_approval') { const e = new Error('PO pending approval me nahi hai'); e.status = 400; throw e; }
  if (nextPendingLevel == null) { const e = new Error('Sab levels pehle se approve hain'); e.status = 400; throw e; }

  const eligible = userEligibleLevel(user);
  if (!eligible.includes(nextPendingLevel)) {
    const e = new Error(`Aapka role level ${nextPendingLevel} approve nahi kar sakta`);
    e.status = 403;
    throw e;
  }

  await prisma.pOApproval.upsert({
    where: { tenantId_poId_level: { tenantId, poId, level: nextPendingLevel } },
    create: { tenantId, poId, level: nextPendingLevel, required: true, approverId: user.sub, decision: 'approved', note: note || null },
    update: { approverId: user.sub, decision: 'approved', note: note || null, decidedAt: new Date() },
  });

  // Sab levels approve?
  const { nextPendingLevel: stillPending } = await getNextPendingLevel({ tenantId, poId });
  if (stillPending == null) {
    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: 'approved', approvedBy: user.sub },
    });
    // Vendor ko email notification
    await notifySafe(async () => {
      const full = await prisma.purchaseOrder.findFirst({
        where: { id: poId, tenantId },
        include: { vendor: true },
      });
      if (full && full.vendor && full.vendor.email) {
        await sendEmail(tenantId, {
          to: full.vendor.email,
          subject: `Purchase Order ${full.number} approved`,
          html: `<p>Dear ${escapeHtml(full.vendor.name)},</p><p>Purchase order <strong>${full.number}</strong> has been approved. Total: <strong>${toNum(full.total).toFixed(2)}</strong>.</p>`,
          text: `Purchase order ${full.number} has been approved. Total: ${toNum(full.total).toFixed(2)}.`,
        });
      }
    });
    await notifySafe(async () => {
      if (po.requestedBy) {
        await notifyOne({ tenantId, userId: po.requestedBy, type: 'po.approved',
          message: `PO ${po.number} fully approved ho gaya hai` });
      }
    });
    return { ok: true, status: 'approved', fullyApproved: true };
  }

  // Level 1 ho gaya, level 2 pending — ceo ko notify karo
  await notifySafe(async () => {
    await notifyRoles(tenantId, ['ceo'], 'po.approval_needed',
      `PO ${po.number}: level 1 approved, ab CEO approval chahiye`);
  });
  return { ok: true, status: 'pending_approval', fullyApproved: false, nextLevel: stillPending };
}

// Reject — current pending level par rejection, PO → rejected
async function reject({ tenantId, poId, user, note }) {
  const { po, nextPendingLevel } = await getNextPendingLevel({ tenantId, poId });
  if (po.status !== 'pending_approval') { const e = new Error('PO pending approval me nahi hai'); e.status = 400; throw e; }
  if (nextPendingLevel == null) { const e = new Error('Sab levels pehle se approve hain'); e.status = 400; throw e; }

  const eligible = userEligibleLevel(user);
  if (!eligible.includes(nextPendingLevel)) {
    const e = new Error(`Aapka role level ${nextPendingLevel} reject nahi kar sakta`);
    e.status = 403;
    throw e;
  }

  await prisma.pOApproval.upsert({
    where: { tenantId_poId_level: { tenantId, poId, level: nextPendingLevel } },
    create: { tenantId, poId, level: nextPendingLevel, required: true, approverId: user.sub, decision: 'rejected', note: note || null },
    update: { approverId: user.sub, decision: 'rejected', note: note || null, decidedAt: new Date() },
  });
  await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'rejected' } });

  await notifySafe(async () => {
    if (po.requestedBy) {
      await notifyOne({ tenantId, userId: po.requestedBy, type: 'po.rejected',
        message: `PO ${po.number} level ${nextPendingLevel} par reject ho gaya` });
    }
  });
  return { ok: true, status: 'rejected' };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = {
  LEVEL2_THRESHOLD,
  approvalEnabled,
  getRequiredLevels,
  userEligibleLevel,
  submitForApproval,
  approve,
  reject,
  getNextPendingLevel,
};
