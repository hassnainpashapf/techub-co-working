// Phase 27 Track 2/5: WhatsApp notifications API.
// Phase 49 Track 3/10: per-tenant WhatsApp Business settings + incoming webhook (additive).
// Mount (already wired): app.use('/api/whatsapp', require('./routes/whatsapp'));
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { tenantFilter } = require('../lib/tenant');
const { writeAudit } = require('../middleware/audit');
const { encryptSecret, decryptSecret } = require('../lib/crypto');
const { sendWhatsapp, sendWhatsappMessage } = require('../lib/whatsapp');

const router = express.Router();

// ---------------------------------------------------------------------------
// PUBLIC: Meta webhook (no JWT — verified via hub.verify_token / signature)
// ---------------------------------------------------------------------------

function hasSettingModel() {
  return !!(prisma.whatsappSetting && typeof prisma.whatsappSetting.findUnique === 'function');
}

async function findSettingByPhoneNumberId(phoneNumberId) {
  if (!hasSettingModel() || !phoneNumberId) return null;
  return prisma.whatsappSetting.findFirst({
    where: { phoneNumberId, isActive: true },
  }).catch(() => null);
}

async function findSettingByVerifyToken(token) {
  if (!hasSettingModel() || !token) return null;
  const all = await prisma.whatsappSetting.findMany({
    where: { isActive: true, verifyTokenEncrypted: { not: null } },
    select: { id: true, tenantId: true, verifyTokenEncrypted: true },
  }).catch(() => []);
  for (const s of all) {
    try {
      const plain = decryptSecret(s.verifyTokenEncrypted);
      if (plain && plain.length === token.length && crypto.timingSafeEqual(Buffer.from(plain), Buffer.from(token))) {
        return s;
      }
    } catch { /* ignore undecryptable rows */ }
  }
  return null;
}

function verifyMetaSignature(req, appSecret) {
  // Best-effort: global express.json() already parsed the body, so we hash the
  // canonical stringified form. Strict byte-level verification needs
  // express.raw() on this route (coordinator/server.js note).
  const sig = req.headers['x-hub-signature-256'];
  if (!appSecret) return { verified: false, reason: 'no_app_secret_configured' };
  if (!sig) return { verified: false, reason: 'missing_signature' };
  const raw = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return { verified: ok, reason: ok ? 'ok' : 'bad_signature' };
}

// GET /webhook — Meta verification handshake
router.get('/webhook', async (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode !== 'subscribe' || !token || !challenge) return res.sendStatus(400);
  const setting = await findSettingByVerifyToken(String(token));
  if (!setting) return res.sendStatus(403);
  return res.status(200).send(String(challenge));
});

// POST /webhook — incoming WhatsApp messages
router.post('/webhook', async (req, res, next) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return res.sendStatus(200); // ack everything Meta sends
    const setting = await findSettingByPhoneNumberId(value?.metadata?.phone_number_id);
    let appSecret = null;
    if (setting?.appSecretEncrypted) {
      try { appSecret = decryptSecret(setting.appSecretEncrypted); } catch { appSecret = null; }
    }
    const sig = verifyMetaSignature(req, appSecret);
    const messages = Array.isArray(value.messages) ? value.messages : [];
    const tenantId = setting ? setting.tenantId : null;

    // Log incoming messages into CommMessage when Track 1's model is merged (guarded).
    const canLogComm = tenantId && prisma.commMessage && typeof prisma.commMessage.create === 'function';
    for (const m of messages) {
      const from = m.from || null;
      const body = m.text?.body || (m.type ? `[${m.type} message]` : '[message]');
      if (canLogComm) {
        await prisma.commMessage.create({
          data: {
            tenantId,
            channel: 'whatsapp',
            direction: 'in',
            body: String(body).slice(0, 4000),
            status: sig.verified ? 'delivered' : 'unverified',
            externalId: m.id || null,
          },
        }).catch(() => {});
      }
      // Phase 49 Track 8: auto-reply hook (best effort, fire-and-forget)
      if (tenantId && from && m.text?.body) {
        try {
          const { maybeAutoReply } = require('../lib/autoReply');
          const { sendWhatsappMessage } = require('../lib/whatsapp');
          maybeAutoReply(tenantId, 'whatsapp', m.text.body, {
            conversationKey: 'wa:' + from,
            sendReply: (replyBody) => sendWhatsappMessage({ tenantId, to: from, text: replyBody }),
          }).catch(() => {});
        } catch {}
      }
    }
    return res.status(200).json({ received: true, messages: messages.length, verified: sig.verified, reason: sig.reason });
  } catch (err) {
    return next(err);
  }
});

router.use(authenticate, requireTenantUser);

const STAFF_ROLES = ['ceo', 'admin', 'super_admin', 'manager'];
const staffOnly = requireRole(...STAFF_ROLES);

const sendSchema = z.object({
  to: z.string().min(5),
  template: z.string().min(1),
  params: z.record(z.any()).optional(),
});

// Send a WhatsApp message — tenant-aware (per-tenant creds -> env fallback -> honest not_configured)
router.post('/send', staffOnly, validateBody(sendSchema), async (req, res, next) => {
  try {
    const { to, template, params } = req.body;
    const result = await sendWhatsappMessage({ tenantId: req.user.tenantId, to, template, params: params || {} });
    await writeAudit({
      tenantId: req.user.tenantId,
      actorId: req.user.sub,
      action: 'whatsapp.send',
      entity: 'WhatsappLog',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: result.sent, ...result });
  } catch (err) {
    return next(err);
  }
});

// List WhatsApp send logs
router.get('/logs', staffOnly, async (req, res, next) => {
  try {
    if (!prisma.whatsappLog) {
      return res.json({ logs: [], note: 'whatsapp_logs table not migrated yet' });
    }
    const logs = await prisma.whatsappLog.findMany({
      where: { ...tenantFilter(req) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ logs });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Phase 49 Track 3/10: per-tenant WhatsApp Business settings (ceo/admin)
// ---------------------------------------------------------------------------

const SETTING_ROLES = ['ceo', 'admin'];
const settingsOnly = requireRole(...SETTING_ROLES);

function maskSetting(s) {
  if (!s) return null;
  const { accessTokenEncrypted, verifyTokenEncrypted, appSecretEncrypted, ...rest } = s;
  return {
    ...rest,
    hasAccessToken: !!accessTokenEncrypted,
    hasVerifyToken: !!verifyTokenEncrypted,
    hasAppSecret: !!appSecretEncrypted,
    accessTokenEncrypted: undefined,
    verifyTokenEncrypted: undefined,
    appSecretEncrypted: undefined,
  };
}

// Merge pending -> 503 (settings endpoints only; /send and /logs keep legacy behavior)
router.use(['/settings', '/test'], (req, res, next) => {
  if (!hasSettingModel()) return res.status(503).json({ error: 'whatsapp settings schema not migrated yet' });
  next();
});

const settingsSchema = z.object({
  phoneNumberId: z.string().max(50).optional().nullable(),
  businessNumber: z.string().max(30).optional().nullable(),
  isActive: z.boolean().optional(),
  accessToken: z.string().max(500).optional().nullable(), // write-only; blank keeps existing
  verifyToken: z.string().max(200).optional().nullable(), // write-only; blank keeps existing
  appSecret: z.string().max(200).optional().nullable(),   // write-only; blank keeps existing
});

// GET /settings — current settings (secrets masked)
router.get('/settings', settingsOnly, async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const s = await prisma.whatsappSetting.findUnique({ where: { tenantId: tf.tenantId } });
    return res.json({ settings: maskSetting(s) });
  } catch (err) {
    return next(err);
  }
});

// PUT /settings — upsert (secrets write-only, never returned)
router.put('/settings', settingsOnly, validateBody(settingsSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { accessToken, verifyToken, appSecret, ...rest } = req.body;
    const data = { ...rest, tenantId: tf.tenantId };
    const enc = (v) => (v && String(v).trim() ? encryptSecret(String(v).trim()) : undefined);
    const at = enc(accessToken);
    const vt = enc(verifyToken);
    const as = enc(appSecret);
    if (at !== undefined) data.accessTokenEncrypted = at;
    if (vt !== undefined) data.verifyTokenEncrypted = vt;
    if (as !== undefined) data.appSecretEncrypted = as;

    const existing = await prisma.whatsappSetting.findUnique({ where: { tenantId: tf.tenantId } });
    const s = existing
      ? await prisma.whatsappSetting.update({ where: { tenantId: tf.tenantId }, data })
      : await prisma.whatsappSetting.create({ data });
    await writeAudit({
      tenantId: tf.tenantId,
      actorId: req.user.sub,
      action: 'whatsapp.settings.update',
      entity: 'WhatsappSetting',
      entityId: s.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ settings: maskSetting(s) });
  } catch (err) {
    return next(err);
  }
});

const testSchema = z.object({ to: z.string().min(5) });

// POST /test — send a plain-text test message via tenant creds
router.post('/test', settingsOnly, validateBody(testSchema), async (req, res, next) => {
  try {
    const result = await sendWhatsappMessage({
      tenantId: req.user.tenantId,
      to: req.body.to,
      text: 'Techub WhatsApp test — agar ye message aya to integration kaam kar rahi hai.',
    });
    return res.json({ ok: result.sent, ...result });
  } catch (err) {
    return res.json({ ok: false, reason: err.message || 'test_failed' });
  }
});

module.exports = router;
