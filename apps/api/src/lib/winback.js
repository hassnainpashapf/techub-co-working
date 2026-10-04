// Phase 54 Track 8: Win-back campaigns — target inactive members ko offer email bhejo.
// Mount wiring (coordinator): sirf route (routes/winback.js) mount hota hai:
//   app.use('/api/winback', require('./routes/winback'));
// Yeh lib require par side-effect nahi karti — runWinback campaignId se chalti hai.

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

// Defensive: schema merge se pehle models maujood na hon to graceful stop.
function hasModels() {
  return !!(prisma && prisma.winbackCampaign && prisma.winbackLog && prisma.member);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Campaign ke targetFilter se inactive members nikalo.
 * targetFilter: { inactiveDays = 60, plans? = [plan strings], includeStatus? }
 * Inactive = na to window me koi booking bani, na koi payment aya.
 * Sirf active/trial status wale members.
 */
async function findTargetMembers(tenantId, filter = {}) {
  const inactiveDays = Math.max(1, Math.min(365, Number(filter.inactiveDays) || 60));
  const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

  const where = {
    tenantId,
    status: { in: filter.includeStatus || ['active', 'trial'] },
  };
  if (Array.isArray(filter.plans) && filter.plans.length) {
    where.plan = { in: filter.plans };
  }
  // Pehle se is tenant ki kisi bhi win-back log me aya member skip (koi bhi campaign me ek dafa)
  // -> yahan per-campaign dedupe WinbackLog unique se, lekin cross-campaign avoid bhi karo
  const loggedIds = await prisma.winbackLog.findMany({
    where: { tenantId },
    select: { memberId: true },
  }).then((rows) => new Set(rows.map((r) => r.memberId)));

  const members = await prisma.member.findMany({
    where: {
      ...where,
      email: { not: null },
      id: loggedIds.size ? { notIn: Array.from(loggedIds) } : undefined,
    },
    select: { id: true, name: true, email: true, plan: true, status: true },
  });

  // Booking/payment activity check — batch me
  const ids = members.map((m) => m.id);
  if (!ids.length) return [];

  const [recentBookings, recentPayments] = await Promise.all([
    prisma.booking.groupBy({
      by: ['memberId'],
      where: { tenantId, memberId: { in: ids }, startAt: { gte: cutoff } },
      _count: { memberId: true },
    }).then((rows) => new Set(rows.map((r) => r.memberId))).catch(() => new Set()),
    prisma.payment.findMany({
      where: { tenantId, paidAt: { gte: cutoff }, invoice: { memberId: { in: ids } } },
      select: { invoice: { select: { memberId: true } } },
    }).then((rows) => new Set(rows.map((r) => r.invoice.memberId))).catch(() => new Set()),
  ]);

  return members.filter((m) => !recentBookings.has(m.id) && !recentPayments.has(m.id));
}

/**
 * Win-back campaign chalao: target members ko offer email + log + sentCount update.
 * Returns { sent, skipped, failed, targets }.
 */
async function runWinback(campaignId, { tenantId, byUserId } = {}) {
  if (!hasModels()) return { error: 'schema_not_merged' };

  const campaign = await prisma.winbackCampaign.findFirst({
    where: { id: campaignId, ...(tenantId ? { tenantId } : {}) },
  });
  if (!campaign) return { error: 'not_found' };
  if (campaign.status === 'done') return { error: 'already_done' };

  const targets = await findTargetMembers(campaign.tenantId, campaign.targetFilter || {});
  const subject = campaign.subject || `We miss you, {{name}} — a special offer inside`;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const member of targets) {
    const email = (member.email || '').trim();
    if (!email) { skipped++; continue; }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2>We miss you, ${escapeHtml(member.name)}!</h2>
        <p>It's been a while since your last visit. Your workspace is waiting for you.</p>
        ${campaign.offerText ? `<div style="background:#f0f4ff;border:1px solid #c7d6ff;padding:16px;border-radius:8px;margin:16px 0"><strong>Special offer:</strong><br/>${escapeHtml(campaign.offerText)}</div>` : ''}
        <p><a href="${process.env.APP_URL || 'https://techub-co-working.pages.dev'}/portal" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Book your desk</a></p>
        <p style="color:#888;font-size:12px">Reply STOP to unsubscribe from win-back offers.</p>
      </div>`;

    try {
      await sendEmail(campaign.tenantId, {
        to: email,
        subject: subject.replace('{{name}}', member.name),
        html,
        text: `We miss you, ${member.name}! ${campaign.offerText ? 'Offer: ' + campaign.offerText : ''}`,
      });
      await prisma.winbackLog.create({
        data: {
          tenantId: campaign.tenantId,
          campaignId: campaign.id,
          memberId: member.id,
          email,
          status: 'sent',
        },
      }).catch((e) => {
        // Unique violation = already sent to this member in this campaign -> treat as skipped
        if (e && e.code === 'P2002') return null;
        throw e;
      });
      sent++;
    } catch (err) {
      failed++;
      await prisma.winbackLog.create({
        data: {
          tenantId: campaign.tenantId,
          campaignId: campaign.id,
          memberId: member.id,
          email,
          status: 'failed',
          error: String(err && err.message ? err.message : err).slice(0, 500),
        },
      }).catch(() => null);
    }
  }

  await prisma.winbackCampaign.update({
    where: { id: campaign.id },
    data: {
      sentCount: { increment: sent },
      lastRunAt: new Date(),
      status: 'active',
    },
  });

  return { sent, skipped, failed, targets: targets.length, campaignId: campaign.id };
}

module.exports = { runWinback, findTargetMembers, hasModels };
