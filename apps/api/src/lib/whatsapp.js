// Phase 27 Track 2/5: WhatsApp notifications via Meta WhatsApp Cloud API.
// Graceful fallback: without WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID we log
// to console and record the attempt as provider='console'.
// NOTE: prisma.whatsappLog exists only after the coordinator merges the
// fragment into schema.prisma — log() degrades silently if missing.

const prisma = require('./prisma');

function logAttempt(data) {
  if (prisma.whatsappLog && typeof prisma.whatsappLog.create === 'function') {
    return prisma.whatsappLog.create({ data }).catch((err) => {
      console.error('[whatsapp] log failed:', err.message);
      return null;
    });
  }
  return Promise.resolve(null);
}

async function sendWhatsapp(tenantId, to, template, params = {}) {
  if (!to || !template) {
    return { sent: false, reason: 'to and template are required' };
  }
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  // No credentials -> console fallback, still record the attempt.
  if (!token || !phoneNumberId) {
    console.log(`[whatsapp:console] to=${to} template=${template} params=${JSON.stringify(params)}`);
    await logAttempt({ tenantId, to, template, params, status: 'sent', provider: 'console' });
    return { sent: true, provider: 'console' };
  }

  const bodyParams = Object.entries(params).map(([_, v]) => ({
    type: 'text',
    text: String(v),
  }));

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: params.language || 'en' },
          components: bodyParams.length
            ? [{ type: 'body', parameters: bodyParams }]
            : [],
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      await logAttempt({ tenantId, to, template, params, status: 'failed', provider: 'meta', error: errMsg });
      return { sent: false, provider: 'meta', reason: errMsg };
    }
    const sid = data?.messages?.[0]?.id || null;
    await logAttempt({ tenantId, to, template, params, status: 'sent', provider: 'meta', providerSid: sid });
    return { sent: true, provider: 'meta', sid };
  } catch (err) {
    await logAttempt({ tenantId, to, template, params, status: 'failed', provider: 'meta', error: err.message });
    return { sent: false, provider: 'meta', reason: err.message };
  }
}

module.exports = { sendWhatsapp };
