// Phase 45 Track 1: AI provider settings API.
// Mount (coordinator): app.use('/api/ai-settings', require('./routes/ai-settings'));
// Sidebar (coordinator): Settings section → { label: 'AI Settings', path: '/settings/ai' } (ceo/admin)
const express = require('express');
const { z } = require('zod');

const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireTenantUser } = require('../middleware/rbac');
const { validateBody } = require('../middleware/validate');
const { writeAudit } = require('../middleware/audit');
const { encryptSecret } = require('../lib/crypto');
const { tenantFilter } = require('../lib/tenant');
const { getAiClient, getAiUsage } = require('../lib/aiProvider');

const router = express.Router();

router.use(authenticate, requireTenantUser, requireRole('ceo', 'admin'));

const PROVIDERS = ['disabled', 'openai', 'anthropic', 'openai-compatible'];
const FEATURES = ['chat', 'insights', 'sentiment'];

const settingsSchema = z.object({
  provider: z.enum(PROVIDERS).default('disabled'),
  apiKey: z.string().max(500).optional().nullable(), // write-only; blank keeps existing
  baseUrl: z.string().max(200).optional().nullable(),
  model: z.string().max(100).optional().nullable(),
  enabledFeatures: z.object({ chat: z.boolean(), insights: z.boolean(), sentiment: z.boolean() }).partial().optional(),
  monthlyTokenCap: z.number().int().min(0).max(100000000).optional().nullable(),
});

function mask(s) {
  if (!s) return null;
  const { apiKeyEncrypted, ...rest } = s;
  return { ...rest, hasApiKey: !!apiKeyEncrypted, apiKeyEncrypted: undefined };
}

// Model missing before merge → 503, not 500
router.use((req, res, next) => {
  if (!prisma.aiSetting) return res.status(503).json({ error: 'ai settings schema not migrated yet' });
  next();
});

// GET / — current settings (key masked)
router.get('/', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const s = await prisma.aiSetting.findUnique({ where: { tenantId: tf.tenantId } });
    const usage = await getAiUsage(tf.tenantId);
    res.json({ settings: mask(s), usage });
  } catch (e) { next(e); }
});

// PUT / — upsert settings (key write-only, never returned)
router.put('/', validateBody(settingsSchema), async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const { apiKey, provider, baseUrl, ...rest } = req.body;
    const data = { ...rest, tenantId: tf.tenantId, provider };
    if (baseUrl !== undefined) {
      if (provider === 'openai-compatible' && baseUrl && !/^https:\/\/[^\/\s]+/.test(baseUrl.trim())) {
        return res.status(422).json({ error: 'baseUrl must be a valid https:// URL' });
      }
      data.baseUrl = baseUrl || null;
    }
    // Blank/omitted key keeps the existing encrypted key
    if (apiKey && String(apiKey).trim()) {
      data.apiKeyEncrypted = encryptSecret(String(apiKey).trim());
    }
    const existing = await prisma.aiSetting.findUnique({ where: { tenantId: tf.tenantId } });
    const s = existing
      ? await prisma.aiSetting.update({ where: { tenantId: tf.tenantId }, data })
      : await prisma.aiSetting.create({ data });
    await writeAudit(req, { action: 'ai-settings.update', entity: 'AiSetting', entityId: s.id, meta: { provider } });
    res.json({ settings: mask(s) });
  } catch (e) { next(e); }
});

// POST /test — ping the provider with a tiny prompt
router.post('/test', async (req, res, next) => {
  try {
    const tf = tenantFilter(req);
    const client = await getAiClient(tf.tenantId);
    if (!client.available) return res.json({ ok: false, reason: client.reason });
    const r = await client.chat([{ role: 'user', content: 'Reply with exactly: OK' }], { maxTokens: 10 });
    res.json({ ok: r.text.trim().toUpperCase().startsWith('OK'), reply: r.text.trim(), provider: client.provider, model: client.model });
  } catch (e) {
    res.json({ ok: false, reason: e.message || 'provider_test_failed' });
  }
});

module.exports = router;
