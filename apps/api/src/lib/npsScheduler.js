// Phase 33 Track 9: NPS auto-invite scheduler.
// Members who joined ~30 days ago get an email invite to the tenant's active NPS survey.
// One invite per (survey, member) — SurveyInvite + unique constraint guards duplicates.
const prisma = require('./prisma');
const { notify, sendEmail } = require('./mailer');

const NPS_INVITE_DAYS = 30;

function getJobs() {
  try {
    const j = require('./jobs');
    if (j && typeof j.enqueue === 'function' && typeof j.registerHandler === 'function') return j;
  } catch {
    /* job queue not available */
  }
  return null;
}

async function sendNpsInvite(tenantId, survey, member) {
  if (!member.email) return { sent: false, reason: 'no-recipient-email' };
  const data = {
    memberName: member.name || 'there',
    surveyTitle: survey.title,
  };
  let result;
  try {
    result = await notify(tenantId, member.email, 'npsSurvey', data);
  } catch (err) {
    result = { sent: false, reason: String((err && err.message) || err) };
  }
  if (result && result.reason === 'unknown-template') {
    try {
      result = await sendEmail(tenantId, {
        to: member.email,
        subject: `How was your first month? — ${survey.title}`,
        html: `<p>Hi ${member.name || 'there'},</p><p>You joined about a month ago — we'd love your feedback. On a scale of 0–10, how likely are you to recommend us?</p><p>Please answer the <b>${survey.title}</b> survey in your member portal.</p>`,
      });
    } catch (err) {
      result = { sent: false, reason: String((err && err.message) || err) };
    }
  }
  return result || { sent: false, reason: 'unknown' };
}

// Invite candidates for one tenant: members joined >=30 days ago, active, no invite yet.
async function processNpsInvites(tenantId) {
  if (!tenantId) throw new Error('tenantId is required');
  const surveys = await prisma.survey.findMany({
    where: { tenantId, type: 'nps', status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
  if (surveys.length === 0) return { processed: 0, sent: 0, skipped: 0, reason: 'no-active-nps-survey' };
  const cutoff = new Date(Date.now() - NPS_INVITE_DAYS * 86400000);
  let sent = 0;
  let skipped = 0;
  const results = [];
  for (const survey of surveys) {
    const members = await prisma.member.findMany({
      where: {
        tenantId,
        status: 'active',
        createdAt: { lte: cutoff },
        surveyInvites: { none: { surveyId: survey.id } },
        surveyResponses: { none: { surveyId: survey.id } },
      },
      select: { id: true, name: true, email: true },
      take: 100,
    });
    for (const member of members) {
      const result = await sendNpsInvite(tenantId, survey, member);
      const ok = !!(result && (result.sent || result.queued));
      if (ok) {
        try {
          await prisma.surveyInvite.create({ data: { surveyId: survey.id, memberId: member.id } });
        } catch (err) {
          if (!String((err && err.code) || '').includes('P2002')) throw err;
        }
        sent++;
      } else {
        skipped++;
      }
      results.push({ surveyId: survey.id, memberId: member.id, sent: ok, reason: ok ? undefined : result.reason });
    }
  }
  return { processed: results.length, sent, skipped, results };
}

async function processAllTenants() {
  const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
  const out = [];
  for (const t of tenants) {
    try {
      const r = await processNpsInvites(t.id);
      out.push({ tenantId: t.id, sent: r.sent, skipped: r.skipped });
    } catch (err) {
      out.push({ tenantId: t.id, error: String((err && err.message) || err) });
    }
  }
  return out;
}

// Register background handler (idempotent) — coordinator can enqueue {type:'nps-scheduler'} daily.
(function registerNpsHandler() {
  const jobs = getJobs();
  if (!jobs || jobs.__npsRegistered) return;
  jobs.__npsRegistered = true;
  jobs.registerHandler('nps-scheduler', async (jobOrPayload) => {
    const p = (jobOrPayload && (jobOrPayload.data || jobOrPayload.payload)) || jobOrPayload || {};
    if (p.tenantId) {
      return processNpsInvites(p.tenantId);
    }
    return processAllTenants();
  });
})();

module.exports = {
  processNpsInvites,
  processAllTenants,
  NPS_INVITE_DAYS,
};
