// Phase 49 Track 1/10: Unified Communication Hub — provider abstraction lib.
// logMessage() + sendViaChannel(): email (mailer), sms (Twilio/console fallback),
// whatsapp (Meta/console fallback), internal (in-app notification), voice (manual
// call log — telephony provider nahi hai to honest "queued" status), note (log only).
//
// Har provider fail-safe hai: credentials missing hon to message queued/console
// me record hoti hai, kabhi throw nahi hota. Status hamesha honest hai.
const prisma = require('./prisma');

const CHANNELS = ['internal', 'email', 'sms', 'whatsapp', 'voice', 'note'];
const STATUSES = ['queued', 'sent', 'delivered', 'failed', 'read'];

// Migration merge na hui ho to model missing hota hai — kabhi crash nahi.
function hasModel() {
  return Boolean(prisma.commMessage && typeof prisma.commMessage.create === 'function');
}

/**
 * Ek CommMessage row create kare. Never throws — fail par null.
 */
async function logMessage(tenantId, {
  channel = 'note',
  direction = 'out',
  memberId = null,
  userId = null,
  to = null,
  subject = null,
  body = '',
  status = 'queued',
  provider = null,
  externalId = null,
  error = null,
  scheduledFor = null,
} = {}) {
  if (!hasModel()) return null;
  try {
    return await prisma.commMessage.create({
      data: {
        tenantId,
        channel,
        direction,
        memberId,
        userId,
        to,
        subject,
        body: String(body || ''),
        status,
        provider,
        externalId,
        error,
        scheduledFor,
        sentAt: ['sent', 'delivered', 'read'].includes(status) ? new Date() : null,
      },
    });
  } catch (e) {
    console.error('[comms] logMessage failed:', e.message);
    return null;
  }
}

async function updateStatus(id, { status, provider, externalId, error }) {
  if (!hasModel() || !id) return;
  try {
    await prisma.commMessage.update({
      where: { id },
      data: {
        status,
        provider: provider || undefined,
        externalId: externalId || undefined,
        error: error || undefined,
        sentAt: ['sent', 'delivered', 'read'].includes(status) ? new Date() : undefined,
      },
    });
  } catch (e) {
    console.error('[comms] updateStatus failed:', e.message);
  }
}

/**
 * Channel ke provider se bheje. Returns { sent, provider, row, error? }.
 * Kabhi throw nahi karta.
 *
 * opts: { channel, memberId, userId, to, subject, body, template, scheduledFor }
 * - email:    to = email address (ya memberId se member email resolve)
 * - sms:      to = phone number
 * - whatsapp: to = phone number, template = Meta template name (default: custom body param)
 * - internal: memberId/userId → in-app notification
 * - voice:    manual call log (telephony nahi — honest queued)
 * - note:     sirf log
 */
async function sendViaChannel(tenantId, {
  channel,
  memberId = null,
  userId = null,
  to = null,
  subject = null,
  body = '',
  template = null,
  scheduledFor = null,
} = {}) {
  if (!CHANNELS.includes(channel)) {
    return { sent: false, error: `invalid channel: ${channel}` };
  }

  const row = await logMessage(tenantId, {
    channel, direction: 'out', memberId, userId, to, subject, body,
    status: 'queued', scheduledFor,
  });

  // Member se contact resolve (to na diya ho to)
  let resolvedTo = to;
  let memberEmail = null;
  let memberPhone = null;
  if (memberId && !resolvedTo) {
    try {
      const member = await prisma.member.findUnique({
        where: { id: memberId },
        select: { email: true, phone: true },
      });
      if (member) {
        memberEmail = member.email || null;
        memberPhone = member.phone || null;
        resolvedTo = channel === 'email' ? memberEmail : memberPhone;
      }
    } catch (e) { /* member read fail — to missing hi rahega */ }
  }

  try {
    if (channel === 'email') {
      const { sendEmail } = require('./mailer');
      const dest = resolvedTo || memberEmail;
      if (!dest) {
        await updateStatus(row && row.id, { status: 'failed', error: 'no email address' });
        return { sent: false, provider: 'mailer', row, error: 'no email address' };
      }
      const result = await sendEmail(tenantId, {
        to: dest,
        subject: subject || 'Message',
        text: String(body || ''),
      });
      const sent = result && result.sent !== false;
      await updateStatus(row && row.id, {
        status: sent ? 'sent' : 'failed',
        provider: 'mailer',
        error: sent ? null : (result && result.error) || 'mailer failed',
      });
      return { sent, provider: 'mailer', row, error: sent ? null : (result && result.error) };
    }

    if (channel === 'sms') {
      const { sendSms } = require('./sms');
      const dest = resolvedTo || memberPhone;
      if (!dest) {
        await updateStatus(row && row.id, { status: 'failed', error: 'no phone number' });
        return { sent: false, provider: 'sms', row, error: 'no phone number' };
      }
      const result = await sendSms(tenantId, dest, String(body || ''));
      await updateStatus(row && row.id, {
        status: result.sent ? 'sent' : 'failed',
        provider: result.provider || 'sms',
        externalId: result.sid || null,
        error: result.sent ? null : result.error || null,
      });
      return { sent: result.sent, provider: result.provider || 'sms', row, error: result.error || null };
    }

    if (channel === 'whatsapp') {
      const { sendWhatsapp } = require('./whatsapp');
      const dest = resolvedTo || memberPhone;
      if (!dest) {
        await updateStatus(row && row.id, { status: 'failed', error: 'no phone number' });
        return { sent: false, provider: 'whatsapp', row, error: 'no phone number' };
      }
      const tpl = template || 'custom_message';
      const result = await sendWhatsapp(tenantId, dest, tpl, { body: String(body || '') });
      await updateStatus(row && row.id, {
        status: result.sent ? 'sent' : 'failed',
        provider: result.provider || 'whatsapp',
        error: result.sent ? null : result.reason || result.error || null,
      });
      return { sent: result.sent, provider: result.provider || 'whatsapp', row, error: result.reason || result.error || null };
    }

    if (channel === 'internal') {
      const { createNotification } = require('./notify');
      // Member ke linked user ko notify, warna role-based
      let targetUserId = userId;
      if (!targetUserId && memberId) {
        try {
          const member = await prisma.member.findUnique({
            where: { id: memberId },
            select: { userId: true },
          });
          targetUserId = (member && member.userId) || null;
        } catch (e) { /* ignore */ }
      }
      await createNotification(prisma, {
        tenantId,
        userId: targetUserId,
        role: targetUserId ? null : 'member',
        type: 'message',
        message: subject ? `${subject}: ${body}` : String(body || ''),
      });
      await updateStatus(row && row.id, { status: 'sent', provider: 'inapp' });
      return { sent: true, provider: 'inapp', row };
    }

    if (channel === 'voice') {
      // Telephony provider nahi — manual call log. Honest: "queued" rakho,
      // taake reception call karke status update kare.
      await updateStatus(row && row.id, {
        status: 'queued',
        provider: 'manual',
        error: 'voice needs telephony provider — call logged, status queued until confirmed',
      });
      return { sent: false, provider: 'manual', row, queued: true, error: 'voice call logged for manual dialing' };
    }

    // note
    await updateStatus(row && row.id, { status: 'read', provider: 'manual' });
    return { sent: true, provider: 'manual', row };
  } catch (e) {
    await updateStatus(row && row.id, { status: 'failed', error: e.message });
    return { sent: false, provider: channel, row, error: e.message };
  }
}

/**
 * Inbound message log kare (webhook se — Track 2/3 wire karenge).
 */
async function logInbound(tenantId, { channel, memberId = null, from = null, body = '', externalId = null }) {
  return logMessage(tenantId, {
    channel, direction: 'in', memberId, to: from, body,
    status: 'read', provider: 'webhook', externalId,
  });
}

module.exports = {
  CHANNELS,
  STATUSES,
  hasModel,
  logMessage,
  logInbound,
  updateStatus,
  sendViaChannel,
};
