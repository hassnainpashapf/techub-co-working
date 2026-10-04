// Phase 54 Track 3: Welcome automation engine
// COORDINATOR JOB WIRING (server.js, additive — do NOT touch it here):
//   require('./lib/welcomeAutomation').ensureWelcomeSequencesScheduled();
// Default sequences: due members (daysSince joined) -> steps with dayOffset <= daysSince -> send -> log (dedupe).
// NOTE: Member model is expected to expose `joinedAt` (fallback: createdAt) — coordinator verify.

const prisma = require('./prisma');
const { sendEmail } = require('./mailer');
const { writeAudit } = require('./audit');

function daysSince(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function safeSteps(seq) {
  const steps = Array.isArray(seq.steps) ? seq.steps : [];
  return steps
    .map((s, i) => ({ index: i, dayOffset: Number(s?.dayOffset ?? -1), channel: String(s?.channel || 'email'), templateId: s?.templateId ?? null, subject: s?.subject ?? null }))
    .filter((s) => s.dayOffset >= 0 && ['email', 'sms', 'whatsapp'].includes(s.channel))
    .sort((a, b) => a.dayOffset - b.dayOffset);
}

async function modelsReady() {
  return !!(prisma.welcomeSequence && prisma.welcomeLog && prisma.member);
}

async function resolveTemplate(templateId, { subject }) {
  // Prefer communication template lib if present; graceful fallback.
  try {
    const templates = require('./commsTemplates');
    const get = templates.getTemplate || templates.getCommsTemplate;
    if (get) {
      const tpl = await get(templateId);
      if (tpl) return { subject: subject || tpl.subject || 'Welcome', body: tpl.body || tpl.html || '' };
    }
  } catch (_) {}
  return { subject: subject || 'Welcome to our space', body: '' };
}

async function sendStep(tenantId, member, step, seqName) {
  const tpl = await resolveTemplate(step.templateId, { subject: step.subject });
  const firstName = (member.name || '').split(' ')[0] || 'Member';
  const subject = (tpl.subject || 'Welcome').replace(/\{\{name\}\}/gi, firstName);
  const body = (tpl.body || `Hello ${firstName},\n\nWelcome to our community!`).replace(/\{\{name\}\}/gi, firstName);
  if (step.channel === 'email') {
    if (!member.email) return { status: 'skipped', error: 'no email' };
    await sendEmail({ tenantId, to: member.email, subject, html: `<pre>${body}</pre>` });
    return { status: 'sent' };
  }
  // SMS/WhatsApp: routed via comms hub — honest queued state until credentials configured.
  try {
    const comms = require('./comms');
    const queue = comms.queueOutbound || comms.queueMessage;
    if (queue) {
      await queue({ tenantId, memberId: member.id, channel: step.channel, subject, body, source: `welcome-sequence:${seqName}` });
      return { status: 'sent' };
    }
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
  return { status: 'skipped', error: 'channel queue unavailable' };
}

async function runWelcomeSequences() {
  if (!(await modelsReady())) return { skipped: true, reason: 'models not merged' };
  const sequences = await prisma.welcomeSequence.findMany({ where: { isActive: true } });
  const out = { processed: 0, sent: 0, skipped: 0, failed: 0 };
  for (const seq of sequences) {
    const steps = safeSteps(seq);
    if (!steps.length) continue;
    const members = await prisma.member.findMany({
      where: { tenantId: seq.tenantId },
      select: { id: true, tenantId: true, name: true, email: true, joinedAt: true, createdAt: true },
    });
    const maxOffset = Math.max(...steps.map((s) => s.dayOffset));
    for (const member of members) {
      const d = daysSince(member.joinedAt || member.createdAt);
      if (d === null || d < 0 || d > maxOffset + 7) continue; // window: dayOffset..+7d catch-up
      for (const step of steps) {
        if (d < step.dayOffset) continue;
        const existing = await prisma.welcomeLog.findUnique({
          where: { sequenceId_memberId_stepIndex: { sequenceId: seq.id, memberId: member.id, stepIndex: step.index } },
        });
        if (existing) continue;
        try {
          const res = await sendStep(seq.tenantId, member, step, seq.name);
          await prisma.welcomeLog.create({
            data: { tenantId: seq.tenantId, memberId: member.id, sequenceId: seq.id, stepIndex: step.index, channel: step.channel, status: res.status, error: res.error || null },
          });
          out.processed++;
          if (res.status === 'sent') out.sent++;
          else if (res.status === 'skipped') out.skipped++;
          else out.failed++;
        } catch (e) {
          await prisma.welcomeLog.create({
            data: { tenantId: seq.tenantId, memberId: member.id, sequenceId: seq.id, stepIndex: step.index, channel: step.channel, status: 'failed', error: String(e.message).slice(0, 500) },
          });
          out.failed++;
        }
      }
    }
    await writeAudit(seq.tenantId, 'welcome.sequence_run', { sequenceId: seq.id, name: seq.name, ...out });
  }
  return out;
}

function ensureWelcomeSequencesScheduled() {
  // Called once from server.js wiring. Phase-38 pattern: daily job via scheduler lib.
  try {
    const scheduler = require('./scheduler');
    if (scheduler && typeof scheduler.registerDaily === 'function') {
      scheduler.registerDaily('welcome-sequence-scan', '0 8 * * *', runWelcomeSequences);
      return true;
    }
  } catch (_) {}
  return false;
}

module.exports = { runWelcomeSequences, ensureWelcomeSequencesScheduled };
