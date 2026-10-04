'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Field, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const PROVIDERS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (custom URL)' },
];

const FEATURES = [
  { key: 'chat', label: 'AI Chat Assistant', desc: 'Member portal chat widget' },
  { key: 'insights', label: 'Weekly Insights', desc: 'Auto-generated business insights' },
  { key: 'sentiment', label: 'Feedback Sentiment', desc: 'Automatic sentiment scoring' },
];

export default function AiSettingsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin']);
  const [form, setForm] = useState({ provider: 'disabled', apiKey: '', baseUrl: '', model: '', enabledFeatures: { chat: true, insights: true, sentiment: true }, monthlyTokenCap: '' });
  const [usage, setUsage] = useState(null);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!allowed) return;
    api.get('/ai-settings')
      .then((d) => {
        if (d.settings) {
          setForm({
            provider: d.settings.provider || 'disabled',
            apiKey: '',
            baseUrl: d.settings.baseUrl || '',
            model: d.settings.model || '',
            enabledFeatures: { chat: true, insights: true, sentiment: true, ...(d.settings.enabledFeatures || {}) },
            monthlyTokenCap: d.settings.monthlyTokenCap ?? '',
          });
          setHasKey(!!d.settings.hasApiKey);
        }
        if (d.usage) setUsage(d.usage);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setMsg('');
    try {
      const payload = {
        provider: form.provider,
        baseUrl: form.baseUrl || null,
        model: form.model || null,
        enabledFeatures: form.enabledFeatures,
        monthlyTokenCap: form.monthlyTokenCap === '' ? null : Number(form.monthlyTokenCap),
      };
      if (form.apiKey) payload.apiKey = form.apiKey;
      const d = await api.put('/ai-settings', payload);
      setHasKey(!!d.settings?.hasApiKey);
      setForm({ ...form, apiKey: '' });
      setMsg('AI settings saved.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const testProvider = async () => {
    setTesting(true); setError(''); setMsg('');
    try {
      const d = await api.post('/ai-settings/test');
      setMsg(d.ok ? `Connection works (${d.provider} / ${d.model})` : `Not working: ${d.reason || 'unknown'}`);
    } catch (err) { setError(err.message); }
    finally { setTesting(false); }
  };

  const toggleFeature = (k) => setForm({ ...form, enabledFeatures: { ...form.enabledFeatures, [k]: !form.enabledFeatures[k] } });

  const pct = usage?.monthlyTokenCap ? Math.min(100, Math.round((usage.tokensUsedThisMonth / usage.monthlyTokenCap) * 100)) : 0;

  return (
    <div className="max-w-2xl">
      <PageHeader title="AI Settings" subtitle="LLM provider for chat, insights & sentiment features" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {msg && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div>}
      {loading ? <Spinner /> : (
        <form onSubmit={save} className="card-premium p-6 space-y-3">
          <Field label="Provider">
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="input-premium w-full">
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          {form.provider !== 'disabled' && (<>
            <Field label={`API Key${hasKey ? ' (saved — leave blank to keep)' : ''}`}>
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={hasKey ? '••••••••' : 'sk-...'} className="input-premium w-full" autoComplete="new-password" />
            </Field>
            {form.provider === 'openai-compatible' && (
              <Field label="Base URL (https only)">
                <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" className="input-premium w-full" />
              </Field>
            )}
            <Field label="Model (optional)">
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="default for provider" className="input-premium w-full" />
            </Field>
            <Field label="Monthly token cap (optional)">
              <input type="number" min="0" value={form.monthlyTokenCap} onChange={(e) => setForm({ ...form, monthlyTokenCap: e.target.value })} placeholder="no cap" className="input-premium w-full" />
            </Field>
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-800">Enabled features</div>
              {FEATURES.map((f) => (
                <label key={f.key} className="flex items-center gap-3 cursor-pointer rounded-xl border border-gray-200 p-3">
                  <input type="checkbox" checked={!!form.enabledFeatures[f.key]} onChange={() => toggleFeature(f.key)} className="w-4 h-4 accent-teal-600" />
                  <div><div className="text-sm text-gray-900">{f.label}</div><div className="text-xs text-gray-500">{f.desc}</div></div>
                </label>
              ))}
            </div>
          </>)}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
            {form.provider !== 'disabled' && (
              <button type="button" onClick={testProvider} disabled={testing} className="btn-secondary">{testing ? 'Testing…' : 'Test connection'}</button>
            )}
          </div>
        </form>
      )}
      {usage && usage.provider !== 'disabled' && (
        <div className="card-premium mt-3 p-6">
          <div className="text-sm font-medium text-gray-800 mb-2">Token usage — {usage.usageMonth}</div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{usage.tokensUsedThisMonth.toLocaleString()} used</span>
            <span>{usage.monthlyTokenCap ? `of ${usage.monthlyTokenCap.toLocaleString()}` : 'no cap'}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-teal-600 to-[#0f766e]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
