// Phase 49 Track 7: Scheduled Messages — "Schedule send" (bhejdo baad me).
//
// Coordinator wiring (server.js me, additive):
//   require('./lib/scheduledComms');
//   require('./lib/scheduledComms').ensureScheduledCommsJob();
//
// Composer integration (coordinator — track 1 ke comms composer me):
//   "📅 Schedule send" toggle + datetime picker → POST /api/comms/schedule
//   { channel, memberIds: [], subject?, body, scheduledFor } ->
//   scheduleMessage({ tenantId, channel, memberIds, body, subject, scheduledFor, userId })
//
// Koi migration nahi — Track 1 ka CommMessage (scheduledFor/status=queued) merge
// hote hi live. Merge se pehle sab gracefully skip (koi crash nahi).
// Fragment note (coordinator/track 1): CommMessage par `attemptCount Int @default(0)`
// field hona chahiye taake retry counting kaam kare; field na ho to lib fallback
// par chalti hai (neeche markAttempt dekho).

const prisma = require('./prisma');

const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 50;
const EVERY_5_MIN = 5 * 60 * 1000;

function getJobs() {
  try {
    return require('./jobs');
  } catch {
    return null;
  }
}

function commsModel() {
  return prisma && prisma.commMessage ? prisma.commMessage : null;
}

// Track 1 ka sendViaChannel lazily — merge se pehle missing ho to graceful.
function getSender() {
  try {
    const comms = require('./comms');
    if (comms && typeof comms.sendViaChannel === 'function') return comms.sendViaChannel;
  } catch { /* Track 1 abhi merge nahi hua */ }
  return null;
}

/**
 * scheduleMessage({tenantId, channel, memberIds, body, subject?, scheduledFor, userId?})
 * → CommMessage queued rows (har member ke liye ek). Returns { scheduled, ids }.
 */
async function scheduleMessage({ tenantId, channel, memberIds = [], body, subject = null, scheduledFor, userId = null }) {
  const model = commsModel();
  if (!model) return { scheduled: 0, ids: [], skipped: 'not_migrated' };
  if (!tenantId || !channel || !body) throw new Error('tenantId, channel, body lazmi hain');
  const when = scheduledFor ? new Date(scheduledFor) : new Date();
  if (isNaN(when.getTime())) throw new Error('scheduledFor invalid date hai');
  const ids = [];
  const uniqMembers = [...new Set((memberIds || []).filter(Boolean))];
  // memberIds khali ho to bhi ek queued row (broadcast/audience baad me resolve ho)
  const targets = uniqMembers.length ? uniqMembers : [null];
  for (const memberId of targets) {
    const row = await model.create({
      data: {
        tenantId,
        channel,
        direction: 'out',
        memberId,
        userId,
        subject,
        body,
        status: 'queued',
        scheduledFor: when,
      },
    }).catch((e) => {
      // attemptCount column na ho to bhi create chale — model spec se bahar fields nahi bheje
      console.error('[scheduled-comms] create failed:', e.message);
      return null;
    });
    if (row) ids.push(row.id);
  }
  return { scheduled: ids.length, ids };
}

// attemptCount update — column merge na hua ho (P2022) to us ke baghair.
async function markAttempt(model, id, patch, attemptCount) {
  try {
    return await model.update({ where: { id }, data: { ...patch, attemptCount } });
  } catch (e) {
    if (e && (e.code === 'P2022' || /attemptCount/i.test(e.message || ''))) {
      return await model.update({ where: { id }, data: patch });
    }
    throw e;
  }
}

/**
 * runScheduledComms() — due queued messages bhejo. Job handler + manual trigger dono.
 */
async function runScheduledComms() {
  const model = commsModel();
  if (!model) return { ok: true, skipped: 'not_migrated' };
  const sendViaChannel = getSender();

  const due = await model.findMany({
    where: { status: 'queued', scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
    take: BATCH_LIMIT,
  }).catch((e) => {
    console.error('[scheduled-comms] find due failed:', e.message);
    return [];
  });

  let sent = 0, failed = 0, deferred = 0;
  for (const msg of due) {
    if (!sendViaChannel) {
      // Sender abhi merge nahi — queued hi rehne do, agle run me try hoga.
      deferred++;
      continue;
    }
    try {
      const res = await sendViaChannel({
        tenantId: msg.tenantId,
        channel: msg.channel,
        memberId: msg.memberId,
        subject: msg.subject,
        body: msg.body,
      });
      if (res && res.sent) {
        await markAttempt(model, msg.id, { status: 'sent', sentAt: new Date(), externalId: res.externalId || null }, (msg.attemptCount || 0) + 1).catch(() => {});
        sent++;
      } else {
        const attempts = (msg.attemptCount || 0) + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        await markAttempt(model, msg.id, { status: terminal ? 'failed' : 'queued' }, attempts).catch(() => {});
        terminal ? failed++ : deferred++;
      }
    } catch (e) {
      const attempts = (msg.attemptCount || 0) + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      await markAttempt(model, msg.id, { status: terminal ? 'failed' : 'queued' }, attempts).catch(() => {});
      console.error('[scheduled-comms] send failed:', e.message);
      terminal ? failed++ : deferred++;
    }
  }
  return { ok: true, checked: due.length, sent, failed, deferred };
}

// Job queue me auto-register (docExpiryJob pattern).
(function register() {
  try {
    const jobs = getJobs();
    if (jobs && typeof jobs.registerHandler === 'function') {
      jobs.registerHandler('scheduled-comms', runScheduledCommsAndReschedule);
    }
  } catch { /* jobs module coordinator baad me merge karega */ }
})();

// Har 5 min me ek pending run ensure karo (self-rescheduling via ensure).
async function ensureScheduledCommsJob() {
  try {
    const jobs = getJobs();
    if (!jobs) return;
    const pending = await prisma.job.count({
      where: { type: 'scheduled-comms', status: 'pending' },
    }).catch(() => 1);
    if (pending === 0) {
      await jobs.enqueue('scheduled-comms', {}, { runAt: new Date(Date.now() + EVERY_5_MIN) });
    }
  } catch (e) {
    console.error('[scheduled-comms] ensure schedule failed:', e.message);
  }
}

// Handler ke end par agla run enqueue karo taake har 5 min chalta rahe.
async function runScheduledCommsAndReschedule() {
  const res = await runScheduledComms();
  try {
    const jobs = getJobs();
    if (jobs) await jobs.enqueue('scheduled-comms', {}, { runAt: new Date(Date.now() + EVERY_5_MIN) });
  } catch { /* ignore */ }
  return res;
}

module.exports = { scheduleMessage, runScheduledComms, runScheduledCommsAndReschedule, ensureScheduledCommsJob };
