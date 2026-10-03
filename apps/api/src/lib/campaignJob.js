// Phase 36 Track 5: Email Campaign Builder — background send handler.
// Runs via the job queue (registerHandler('campaign-send', ...)).
// Each recipient goes through the queued mailer (sendEmail -> 'email' jobs),
// so bulk sends never block the API and never hit SMTP directly in a loop.
const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

function modelsReady() {
  return !!(prisma.emailCampaign && prisma.emailUnsubscribe);
}

async function processCampaignSend(job) {
  if (!modelsReady()) return; // schema fragment not merged yet — skip quietly
  const payload = job.payload || job.data || {};
  const { campaignId, recipients = [], unsubscribeBase, tenantId } = payload;
  if (!campaignId || !recipients.length) return;

  const campaign = await prisma.emailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status === 'sent') return; // already done / cancelled

  // Unsubscribed emails for this tenant — skip them.
  const unsubs = await prisma.emailUnsubscribe.findMany({
    where: { tenantId: campaign.tenantId },
    select: { email: true },
  });
  const unsubSet = new Set(unsubs.map((u) => u.email.toLowerCase()));

  let sent = 0;
  for (const r of recipients) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!email || unsubSet.has(email)) continue;
    try {
      // Per-recipient unsubscribe link (token created at send time).
      let tok = await prisma.emailUnsubscribe.findUnique({
        where: { tenantId_email: { tenantId: campaign.tenantId, email } },
        select: { token: true },
      });
      if (!tok) {
        tok = await prisma.emailUnsubscribe.create({
          data: {
            tenantId: campaign.tenantId,
            email,
            token: require('crypto').randomBytes(24).toString('hex'),
          },
          select: { token: true },
        });
      }
      const name = r.name || email.split('@')[0];
      const html =
        campaign.bodyHtml.replace(/\{\{\s*name\s*\}\}/gi, name) +
        `<br><br><hr><p style="font-size:12px;color:#888">` +
        `You received this because you're a member. ` +
        `<a href="${unsubscribeBase}/unsubscribe/${tok.token}">Unsubscribe</a></p>`;
      await sendEmail(campaign.tenantId, {
        to: email,
        subject: campaign.subject,
        html,
      });
      sent += 1;
    } catch (e) {
      console.error('[campaign] send failed for', r.email, e.message);
    }
  }

  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: { sentCount: { increment: sent }, status: 'sent' },
  });
}

// Auto-register with the job queue when available (module load = coordinator
// only needs `require('./lib/campaignJob')` in server.js).
(function register() {
  try {
    const jobs = require('./jobs');
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('campaign-send', async (job) => processCampaignSend(job));
    }
  } catch {
    /* jobs module not present — coordinator merges it later */
  }
})();

module.exports = { processCampaignSend };
