// Phase 36 Track 9: SMS Campaign sending job.
// Mount wiring (coordinator): server.js me `require('./lib/smsCampaigns');`
// taake handler auto-register ho jaye.

const prisma = require('./prisma');
const { sendSms } = require('./sms');

let jobsLib = null;
function getJobs() {
  if (!jobsLib) {
    try {
      jobsLib = require('./jobs');
    } catch (e) {
      jobsLib = null;
    }
  }
  return jobsLib;
}

// GSM-7 single segment = 160, multi = 153. Unicode = 70 / 67.
function smsSegments(text) {
  if (!text) return { chars: 0, segments: 0, encoding: 'gsm7' };
  const isGsm7 = /^[\x00-\x7F]*$/.test(text);
  const chars = [...text].length;
  const per = isGsm7 ? (chars <= 160 ? 160 : 153) : chars <= 70 ? 70 : 67;
  return {
    chars,
    segments: Math.max(1, Math.ceil(chars / per)),
    encoding: isGsm7 ? 'gsm7' : 'unicode',
  };
}

// Segment spec: { type: 'all_active' | 'overdue' | 'trial' }
async function resolveRecipients(tenantId, segment = {}) {
  const type = segment.type || 'all_active';
  const where = { tenantId, phone: { not: '' } };
  if (type === 'trial') {
    where.status = 'trial';
  } else if (type === 'overdue') {
    // Overdue wale members (koi bhi open invoice jiski dueDate guzar gayi)
    const overdue = await prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: ['unpaid', 'partial', 'overdue'] },
        dueDate: { lt: new Date() },
      },
      select: { memberId: true },
      distinct: ['memberId'],
    });
    const ids = overdue.map((i) => i.memberId).filter(Boolean);
    if (!ids.length) return [];
    where.id = { in: ids };
  } else {
    where.status = 'active';
  }
  return prisma.member.findMany({
    where,
    select: { id: true, name: true, phone: true },
    orderBy: { name: 'asc' },
  });
}

async function processSmsCampaign(payload = {}) {
  const { campaignId } = payload;
  if (!campaignId) throw new Error('campaignId missing');
  if (!prisma.smsCampaign) {
    console.error('[sms-campaign] model not migrated yet');
    return { ok: false, reason: 'not_migrated' };
  }
  const campaign = await prisma.smsCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error('campaign not found');
  if (campaign.status === 'sent') return { ok: true, already: true };

  await prisma.smsCampaign.update({
    where: { id: campaignId },
    data: { status: 'sending' },
  });

  const recipients = await resolveRecipients(campaign.tenantId, campaign.segment || {});
  let sent = 0;
  let failed = 0;

  for (const m of recipients) {
    try {
      const r = await sendSms(campaign.tenantId, m.phone, campaign.message);
      if (r.sent) sent += 1;
      else failed += 1;
    } catch (e) {
      failed += 1;
    }
    // Batch progress save (agar bara campaign ho)
    if ((sent + failed) % 50 === 0) {
      await prisma.smsCampaign.update({
        where: { id: campaignId },
        data: { sentCount: sent, failCount: failed },
      }).catch(() => {});
    }
    // Throttle taake provider rate limit na lage (Twilio ~1/sec safe)
    await new Promise((r) => setTimeout(r, 1200));
  }

  await prisma.smsCampaign.update({
    where: { id: campaignId },
    data: {
      status: failed > 0 && sent === 0 ? 'failed' : 'sent',
      sentCount: sent,
      failCount: failed,
      sentAt: new Date(),
    },
  });

  return { ok: true, sent, failed, total: recipients.length };
}

// jobs.js maujud ho to auto-register (dunning wala idempotent pattern).
(function autoRegister() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('sms-campaign', processSmsCampaign);
    }
  } catch (e) {
    // deploy par coordinator wire karega
  }
})();

module.exports = { processSmsCampaign, resolveRecipients, smsSegments };
