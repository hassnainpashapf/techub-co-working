// Phase 40 Track 7: Member Newsletter Builder — background send handler.
// Runs via the job queue (registerHandler('newsletter-send', ...)).
// Each recipient goes through the queued mailer (sendEmail -> 'email' jobs),
// so bulk sends never block the API and never hit SMTP directly in a loop.
const prisma = require('./prisma');
const { sendEmail } = require('./mailer');

function modelsReady() {
  return !!(prisma.newsletter && prisma.newsletterSend);
}

async function processNewsletterSend(job) {
  if (!modelsReady()) return; // schema fragment not merged yet — skip quietly
  const payload = job.payload || job.data || {};
  const { newsletterId, recipients = [] } = payload;
  if (!newsletterId || !recipients.length) return;

  const newsletter = await prisma.newsletter.findUnique({ where: { id: newsletterId } });
  if (!newsletter || newsletter.status === 'sent') return; // already done / cancelled

  // Lazy import to avoid circular deps with routes.
  let sectionsToHtml;
  try {
    sectionsToHtml = require('../routes/newsletters').sectionsToHtml;
  } catch { sectionsToHtml = null; }

  const bodyHtml = sectionsToHtml
    ? sectionsToHtml(newsletter.sections || [])
    : '<p>Newsletter</p>';

  let sent = 0;
  for (const r of recipients) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!email) continue;
    try {
      // Skip if already logged as sent for this newsletter (idempotent re-run).
      if (r.id) {
        const existing = await prisma.newsletterSend.findUnique({
          where: { newsletterId_memberId: { newsletterId, memberId: r.id } },
          select: { id: true },
        }).catch(() => null);
        if (existing) { sent += 1; continue; }
      }
      // Per-recipient unsubscribe link (token created at send time) — phase 36 pattern.
      let unsubLink = '';
      if (prisma.emailUnsubscribe) {
        let tok = await prisma.emailUnsubscribe.findUnique({
          where: { tenantId_email: { tenantId: newsletter.tenantId, email } },
          select: { token: true },
        });
        if (!tok) {
          tok = await prisma.emailUnsubscribe.create({
            data: {
              tenantId: newsletter.tenantId,
              email,
              token: require('crypto').randomBytes(24).toString('hex'),
            },
            select: { token: true },
          });
        }
        unsubLink = `<br><br><hr><p style="font-size:12px;color:#888">` +
          `You received this because you're a member. ` +
          `<a href="${process.env.FRONTEND_URL || 'https://techub-co-working.pages.dev'}/unsubscribe/${tok.token}">Unsubscribe</a></p>`;
      }
      const name = r.name || email.split('@')[0];
      const html = bodyHtml.replace(/\{\{\s*name\s*\}\}/gi, name) + unsubLink;
      await sendEmail(newsletter.tenantId, {
        to: email,
        subject: newsletter.subject,
        html,
      });
      if (r.id) {
        await prisma.newsletterSend.upsert({
          where: { newsletterId_memberId: { newsletterId, memberId: r.id } },
          update: {},
          create: { newsletterId, memberId: r.id },
        }).catch(() => {});
      }
      sent += 1;
    } catch (e) {
      console.error('[newsletter] send failed for', r.email, e.message);
    }
  }

  await prisma.newsletter.update({
    where: { id: newsletterId },
    data: { sentCount: sent, status: 'sent', sentAt: new Date() },
  });
}

// Auto-register with the job queue when available (module load = coordinator
// only needs `require('./lib/newsletterJob')` in server.js).
(function register() {
  try {
    const jobs = require('./jobs');
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('newsletter-send', async (job) => processNewsletterSend(job));
    }
  } catch {
    /* jobs module not present — coordinator merges it later */
  }
})();

module.exports = { processNewsletterSend };
