// Phase 45 Track 1: AI provider client — per-tenant LLM access.
// Falls back to { available: false, reason } when AI is not configured,
// so feature code (chat/insights/sentiment) can degrade to rule-based
// engines without crashing. Uses SSRF-protected safePost for all HTTP.
const prisma = require('./prisma');
const { decryptSecret } = require('./crypto');
const { safePost } = require('./safeFetch');

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  'openai-compatible': 'gpt-4o-mini',
};

const PROVIDER_ENDPOINTS = {
  openai: () => 'https://api.openai.com/v1/chat/completions',
  anthropic: () => 'https://api.anthropic.com/v1/messages',
  'openai-compatible': (s) => `${s.baseUrl.replace(/\/$/, '')}/chat/completions`,
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// Returns a live client or { available: false, reason }.
// client.chat(messages, opts) → { text, tokens } | throws on provider error.
async function getAiClient(tenantId) {
  const settings = await prisma.aiSetting.findUnique({ where: { tenantId } }).catch(() => null);
  if (!settings || settings.provider === 'disabled') {
    return { available: false, reason: 'ai_not_enabled' };
  }
  if (!settings.apiKeyEncrypted) {
    return { available: false, reason: 'ai_key_missing' };
  }
  let apiKey;
  try {
    apiKey = decryptSecret(settings.apiKeyEncrypted);
  } catch (e) {
    return { available: false, reason: 'ai_key_unreadable' };
  }
  const month = currentMonth();
  if (settings.usageMonth !== month) {
    await prisma.aiSetting
      .update({ where: { tenantId }, data: { usageMonth: month, tokensUsedThisMonth: 0 } })
      .catch(() => null);
    settings.tokensUsedThisMonth = 0;
    settings.usageMonth = month;
  }
  if (settings.monthlyTokenCap && settings.tokensUsedThisMonth >= settings.monthlyTokenCap) {
    return { available: false, reason: 'ai_quota_exceeded' };
  }

  const provider = settings.provider;
  const model = settings.model || DEFAULT_MODELS[provider];
  const baseUrl = (settings.baseUrl || '').trim();
  if (provider === 'openai-compatible') {
    if (!/^https:\/\/[^\/\s]+/.test(baseUrl)) {
      return { available: false, reason: 'ai_base_url_unsafe' };
    }
  }
  const endpoint = PROVIDER_ENDPOINTS[provider]
    ? PROVIDER_ENDPOINTS[provider]({ baseUrl })
    : PROVIDER_ENDPOINTS['openai-compatible']({ baseUrl });

  async function recordUsage(tokens) {
    if (!tokens) return;
    await prisma.aiSetting
      .update({ where: { tenantId }, data: { tokensUsedThisMonth: { increment: tokens } } })
      .catch(() => null);
  }

  async function chat(messages, { maxTokens = 800, temperature = 0.3, system } = {}) {
    const msgs = Array.isArray(messages) ? messages.slice() : [];
    if (system) msgs.unshift({ role: 'system', content: system });
    let payload, headers;
    if (provider === 'anthropic') {
      payload = { model, max_tokens: maxTokens, temperature, messages: msgs.filter((m) => m.role !== 'system'), system: system || undefined };
      headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    } else {
      payload = { model, max_tokens: maxTokens, temperature, messages: msgs };
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    }
    const res = await safePost(endpoint, { headers, body: JSON.stringify(payload), timeoutMs: 30000 });
    if (res.status !== 200) {
      throw new Error(`ai_provider_error_${res.status}`);
    }
    let data;
    try {
      data = JSON.parse(res.body || '{}');
    } catch (e) {
      throw new Error('ai_provider_bad_response');
    }
    const text =
      provider === 'anthropic'
        ? (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
        : data.choices?.[0]?.message?.content || '';
    const tokens =
      (data.usage?.input_tokens || 0) +
      (data.usage?.output_tokens || 0) +
      (data.usage?.prompt_tokens || 0) +
      (data.usage?.completion_tokens || 0);
    await recordUsage(tokens);
    return { text: String(text).slice(0, 8000), tokens };
  }

  return { available: true, provider, model, chat };
}

async function getAiUsage(tenantId) {
  const s = await prisma.aiSetting.findUnique({ where: { tenantId } }).catch(() => null);
  const month = currentMonth();
  return {
    provider: s?.provider || 'disabled',
    model: s?.model || null,
    enabledFeatures: s?.enabledFeatures || {},
    monthlyTokenCap: s?.monthlyTokenCap || null,
    tokensUsedThisMonth: s && s.usageMonth === month ? s.tokensUsedThisMonth : 0,
    usageMonth: s?.usageMonth || month,
  };
}

module.exports = { getAiClient, getAiUsage, currentMonth };
