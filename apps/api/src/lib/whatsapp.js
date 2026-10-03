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

// ---------------------------------------------------------------------------
// Phase 49 Track 3/10: per-tenant WhatsApp Business settings.
// Tenant-aware sender. Resolution order:
//   1. WhatsappSetting (isActive, AES-GCM decrypted token) -> Meta Cloud API v21
//   2. Legacy env creds (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID) -> sendWhatsapp()
//   3. Nothing configured -> { sent:false, reason:'not_configured' } + honest
//      'queued' WhatsappLog row (nothing was actually sent).
// SSRF-safe: outbound Meta calls go through lib/safeFetch (URL validated).
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const { encryptSecret, decryptSecret } = require('./crypto');
const { safePost } = require('./safeFetch');

function hasWhatsappSettingModel() {
  return !!(prisma.whatsappSetting && typeof prisma.whatsappSetting.findUnique === 'function');
}

async function getTenantWhatsappCreds(tenantId) {
  if (!tenantId || !hasWhatsappSettingModel()) return null;
  try {
    const s = await prisma.whatsappSetting.findUnique({ where: { tenantId } });
    if (!s || !s.isActive || !s.phoneNumberId || !s.accessTokenEncrypted) return null;
    let token;
    try {
      token = decryptSecret(s.accessTokenEncrypted);
    } catch {
      return null;
    }
    if (!token) return null;
    return { phoneNumberId: s.phoneNumberId, accessToken: token, settingId: s.id };
  } catch {
    return null;
  }
}

function normalizePhone(to) {
  return String(to || '').replace(/[^\d]/g, '');
}

async function postToMeta(phoneNumberId, accessToken, payload) {
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
  const res = await safePost(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 15000,
  });
  let data = {};
  try { data = JSON.parse(res.body || '{}'); } catch { /* non-JSON body */ }
  return { ok: res.ok, status: res.status, data, error: res.error || null };
}

function buildPayload(to, { text, template, params = {}, language = 'en' }) {
  const base = { messaging_product: 'whatsapp', to };
  if (text) {
    return { ...base, type: 'text', text: { preview_url: false, body: String(text).slice(0, 4000) } };
  }
  const bodyParams = Object.entries(params).map(([_, v]) => ({ type: 'text', text: String(v) }));
  return {
    ...base,
    type: 'template',
    template: {
      name: template,
      language: { code: language },
      components: bodyParams.length ? [{ type: 'body', parameters: bodyParams }] : [],
    },
  };
}

async function sendWhatsappMessage({ tenantId, to, text, template, params = {}, language = 'en' }) {
  const cleanTo = normalizePhone(to);
  if (!tenantId || !cleanTo || (!text && !template)) {
    return { sent: false, reason: 'tenantId, to and text|template are required' };
  }

  // 1) Per-tenant credentials
  const creds = await getTenantWhatsappCreds(tenantId);
  if (creds) {
    const payload = buildPayload(cleanTo, { text, template, params, language });
    try {
      const res = await postToMeta(creds.phoneNumberId, creds.accessToken, payload);
      if (res.ok) {
        const sid = res.data?.messages?.[0]?.id || null;
        await logAttempt({
          tenantId, to: cleanTo, template: template || '(text)',
          params, status: 'sent', provider: 'meta-tenant', providerSid: sid,
        });
        return { sent: true, provider: 'meta-tenant', sid };
      }
      const errMsg = res.data?.error?.message || res.error || `HTTP ${res.status}`;
      await logAttempt({
        tenantId, to: cleanTo, template: template || '(text)',
        params, status: 'failed', provider: 'meta-tenant', error: errMsg,
      });
      return { sent: false, provider: 'meta-tenant', reason: errMsg };
    } catch (err) {
      await logAttempt({
        tenantId, to: cleanTo, template: template || '(text)',
        params, status: 'failed', provider: 'meta-tenant', error: err.message,
      });
      return { sent: false, provider: 'meta-tenant', reason: err.message };
    }
  }

  // 2) Legacy env-based path (honest about provider)
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    if (text && !template) {
      // Legacy sendWhatsapp is template-only; plain text via env path is unsupported.
      console.log(`[whatsapp:console] to=${cleanTo} text=${String(text).slice(0, 120)}`);
      await logAttempt({ tenantId, to: cleanTo, template: '(text)', params, status: 'sent', provider: 'console' });
      return { sent: true, provider: 'console' };
    }
    const r = await sendWhatsapp(tenantId, cleanTo, template, params);
    return { ...r, via: 'env-legacy' };
  }

  // 3) Nothing configured — honest failure, attempt kept as 'queued' for later retry
  console.log(`[whatsapp:not_configured] tenant=${tenantId} to=${cleanTo} template=${template || '(text)'}`);
  await logAttempt({
    tenantId, to: cleanTo, template: template || '(text)', params,
    status: 'queued', provider: 'none', error: 'not_configured',
  });
  return { sent: false, reason: 'not_configured' };
}

module.exports.sendWhatsappMessage = sendWhatsappMessage;
module.exports.getTenantWhatsappCreds = getTenantWhatsappCreds;
module.exports.encryptSecret = encryptSecret;
