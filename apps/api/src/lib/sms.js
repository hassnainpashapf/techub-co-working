// Phase 27 Track 1: SMS sending via Twilio (plain fetch, no extra dependency).
// Graceful fallback: agar Twilio env missing ho to console log + SmsLog me
// provider='console' record (dev/test me kaam karta hai, prod me fail nahi hota).
const prisma = require('./prisma');

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM;

function twilioConfigured() {
  return Boolean(SID && TOKEN && FROM);
}

async function recordLog(tenantId, to, body, data) {
  try {
    await prisma.smsLog.create({
      data: { tenantId, to, body, ...data },
    });
  } catch (e) {
    // Model/migration abhi merge nahi hui ho to crash na ho
    console.error('[sms] log write failed:', e.message);
  }
}

/**
 * Send an SMS. Returns { sent, provider, sid?, error? }.
 */
async function sendSms(tenantId, to, body) {
  if (!to || !body) {
    return { sent: false, error: 'to and body are required' };
  }

  // Dev/console fallback — Twilio configured nahi hai
  if (!twilioConfigured()) {
    console.log(`[sms:console] to=${to} body=${body}`);
    await recordLog(tenantId, to, body, { status: 'sent', provider: 'console' });
    return { sent: true, provider: 'console' };
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: FROM, To: to, Body: body }).toString(),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.message || `Twilio HTTP ${res.status}`;
      await recordLog(tenantId, to, body, { status: 'failed', provider: 'twilio', error: err });
      return { sent: false, provider: 'twilio', error: err };
    }
    await recordLog(tenantId, to, body, {
      status: 'sent',
      provider: 'twilio',
      providerSid: data.sid || null,
    });
    return { sent: true, provider: 'twilio', sid: data.sid };
  } catch (e) {
    await recordLog(tenantId, to, body, { status: 'failed', provider: 'twilio', error: e.message });
    return { sent: false, provider: 'twilio', error: e.message };
  }
}

module.exports = { sendSms, twilioConfigured };
