'use client';

// Phase 36 Track 3: Slack Integration settings page.
import { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner } from '../../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../../components/Protected';

export default function SlackPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin']);
  const [config, setConfig] = useState(null);
  const [supportedEvents, setSupportedEvents] = useState([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [channel, setChannel] = useState('');
  const [events, setEvents] = useState([]);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await api.get('/slack/config');
      setConfig(d.config || null);
      setSupportedEvents(d.supportedEvents || []);
      setChannel(d.config?.channel || '');
      setEvents(d.config?.events || []);
      setIsActive(d.config ? !!d.config.isActive : true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const toggleEvent = (key) => {
    setEvents((prev) => (prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key]));
  };

  const save = async () => {
    setSaving(true); setError(''); setMsg('');
    try {
      const d = await api.put('/slack/config', { webhookUrl, channel: channel || null, events, isActive });
      setConfig(d.config || null);
      setWebhookUrl('');
      setMsg(d.config?.configured ? 'Slack integration saved.' : 'Slack integration removed.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true); setError(''); setMsg('');
    try {
      await api.post('/slack/test');
      setMsg('Test message sent — apne Slack channel me check karein.');
    } catch (e) {
      setError(e.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Slack Integration" subtitle="Bookings, payments, urgent tickets aur visitor check-ins ki notifications Slack me bhejein." />
      {error && <ErrorBanner message={error} />}
      {msg && <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200 mb-4">{msg}</div>}

      <div className="card-premium p-6 max-w-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">💬 Slack Webhook</h2>
          {config?.configured && (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${config.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}`}>
              {config.isActive ? 'ACTIVE' : 'PAUSED'}
            </span>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Incoming Webhook URL</label>
          <input
            type="password"
            className="input font-mono"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={config?.configured ? '•••••••• (nayi URL yahan paste karein)' : 'https://hooks.slack.com/services/…'}
          />
          <p className="text-xs text-slate-500 mt-1.5">
            Slack me apne channel ke liye <b>Incoming Webhooks</b> app se URL banayein. URL encrypted store hoti hai.
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Channel (optional, sirf label)</label>
          <input
            type="text"
            className="input"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="#bookings"
          />
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-300 mb-2">Kin events par notify karein</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {supportedEvents.map((ev) => (
              <label key={ev.key} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 cursor-pointer hover:border-white/20">
                <input
                  type="checkbox"
                  checked={events.includes(ev.key)}
                  onChange={() => toggleEvent(ev.key)}
                  className="mt-1 accent-blue-500"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">{ev.label}</span>
                  <span className="block text-xs text-slate-400">{ev.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <input
            id="slack-active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="accent-blue-500"
          />
          <label htmlFor="slack-active" className="text-sm text-slate-300">Integration active</label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {config?.configured && (
            <button onClick={sendTest} disabled={testing} className="btn-secondary">
              {testing ? 'Sending…' : '📨 Send Test Message'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
