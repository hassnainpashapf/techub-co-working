'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Field, Spinner, ErrorBanner, DataTable } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const STATUS_BADGE = { sent: 'success', failed: 'danger', queued: 'warning' };

export default function WhatsappPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin', 'manager']);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [f, setF] = useState({ to: '', template: 'hello_world', params: '' });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');
  // Phase 49: per-tenant WhatsApp Business settings
  const [cfg, setCfg] = useState({ phoneNumberId: '', accessToken: '', verifyToken: '', appSecret: '', businessNumber: '', isActive: false });
  const [cfgInfo, setCfgInfo] = useState(null);
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState('');
  const [testTo, setTestTo] = useState('');

  const loadCfg = async () => {
    try {
      const d = await api.get('/whatsapp/settings');
      const s = d.settings || d;
      setCfgInfo(s);
      setCfg((c) => ({ ...c, phoneNumberId: s?.phoneNumberId || '', businessNumber: s?.businessNumber || '', isActive: !!s?.isActive }));
    } catch {}
  };

  const saveCfg = async (e) => {
    e.preventDefault(); setCfgBusy(true); setCfgMsg('');
    try {
      await api.put('/whatsapp/settings', {
        phoneNumberId: cfg.phoneNumberId || null,
        accessToken: cfg.accessToken || null,
        verifyToken: cfg.verifyToken || null,
        appSecret: cfg.appSecret || null,
        businessNumber: cfg.businessNumber || null,
        isActive: cfg.isActive,
      });
      setCfg((c) => ({ ...c, accessToken: '', verifyToken: '', appSecret: '' }));
      setCfgMsg('Settings save ho gayin.');
      await loadCfg();
    } catch (err) { setCfgMsg(err.message); }
    finally { setCfgBusy(false); }
  };

  const testCfg = async () => {
    if (!testTo.trim()) return;
    setCfgBusy(true); setCfgMsg('');
    try {
      const d = await api.post('/whatsapp/test', { to: testTo.trim() });
      setCfgMsg(d.sent ? `Test sent (${d.provider || 'ok'})` : `Failed: ${d.reason || 'unknown'}`);
    } catch (err) { setCfgMsg(err.message); }
    finally { setCfgBusy(false); }
  };

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/whatsapp/logs').then((d) => { setLogs(d.logs || []); setError(d.note || ''); }).catch((e) => setError(e.message)),
      loadCfg(),
    ]).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (!allowed) return <AccessDenied />;

  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    setResult('');
    try {
      let params = {};
      if (f.params.trim()) params = JSON.parse(f.params);
      const d = await api.post('/whatsapp/send', { to: f.to, template: f.template, params });
      setResult(d.sent ? `Sent (${d.provider || 'ok'})` : `Failed: ${d.reason || 'unknown'}`);
      if (d.sent) { setF({ to: '', template: 'hello_world', params: '' }); load(); }
    } catch (err) {
      setResult(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader title="WhatsApp Notifications" subtitle="Send template messages via Meta WhatsApp Cloud API (console fallback when unconfigured)" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="card-premium p-6 mb-6 max-w-xl">
        <h3 className="text-gray-900 font-bold mb-1">Business Settings</h3>
        <p className="text-xs text-gray-500 mb-4">Meta Cloud API credentials (Meta developer dashboard se). Tokens write-only hain — dobara nahi dikhenge.</p>
        {cfgInfo && (
          <div className="flex gap-2 mb-4 text-xs">
            <Badge tone={cfgInfo.isActive ? 'success' : 'warning'}>{cfgInfo.isActive ? 'Active' : 'Inactive'}</Badge>
            {cfgInfo.hasAccessToken && <Badge tone="info">Token set</Badge>}
            {cfgInfo.hasVerifyToken && <Badge tone="info">Verify token set</Badge>}
            {cfgInfo.hasAppSecret && <Badge tone="info">App secret set</Badge>}
          </div>
        )}
        <form onSubmit={saveCfg}>
          <Field label="Phone Number ID">
            <input className="input" value={cfg.phoneNumberId} onChange={(e) => setCfg({ ...cfg, phoneNumberId: e.target.value })} placeholder="1234567890" />
          </Field>
          <Field label="Access Token (permanent)">
            <input type="password" className="input" value={cfg.accessToken} onChange={(e) => setCfg({ ...cfg, accessToken: e.target.value })} placeholder={cfgInfo?.hasAccessToken ? '•••••• (khali = purana rakho)' : 'EAAB...'} />
          </Field>
          <Field label="Verify Token (webhook)">
            <input type="password" className="input" value={cfg.verifyToken} onChange={(e) => setCfg({ ...cfg, verifyToken: e.target.value })} placeholder={cfgInfo?.hasVerifyToken ? '•••••• (khali = purana rakho)' : 'my-verify-token'} />
          </Field>
          <Field label="App Secret (signature verify)">
            <input type="password" className="input" value={cfg.appSecret} onChange={(e) => setCfg({ ...cfg, appSecret: e.target.value })} placeholder={cfgInfo?.hasAppSecret ? '•••••• (khali = purana rakho)' : 'optional'} />
          </Field>
          <Field label="Business Number (display)">
            <input className="input" value={cfg.businessNumber} onChange={(e) => setCfg({ ...cfg, businessNumber: e.target.value })} placeholder="923001234567" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-600 mb-4">
            <input type="checkbox" checked={cfg.isActive} onChange={(e) => setCfg({ ...cfg, isActive: e.target.checked })} />
            Active (bhejna on karein)
          </label>
          <button type="submit" className="btn-primary" disabled={cfgBusy}>{cfgBusy ? 'Saving…' : 'Save Settings'}</button>
          {cfgMsg && <p className="text-sm text-gray-600 mt-3">{cfgMsg}</p>}
        </form>
        <div className="mt-4 pt-4 border-t border-gray-200">
          <Field label="Test number (country code ke sath)">
            <div className="flex gap-2">
              <input className="input flex-1" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="923001234567" />
              <button type="button" onClick={testCfg} disabled={cfgBusy || !testTo.trim()} className="btn-primary !w-auto">Test</button>
            </div>
          </Field>
        </div>
      </div>

      <div className="card-premium p-6 mb-6 max-w-xl">
        <h3 className="text-gray-900 font-bold mb-4">Send message</h3>
        <form onSubmit={send}>
          <Field label="To (phone with country code, e.g. 923001234567)">
            <input className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required placeholder="923001234567" />
          </Field>
          <Field label="Template name">
            <input className="input" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} required placeholder="hello_world" />
          </Field>
          <Field label="Template params (JSON — body parameter values)">
            <textarea className="input font-mono text-xs" rows={3} value={f.params} onChange={(e) => setF({ ...f, params: e.target.value })} placeholder='{"name": "Ahmed"}' />
          </Field>
          <button type="submit" className="btn-primary" disabled={sending}>{sending ? 'Sending…' : 'Send WhatsApp'}</button>
          {result && <p className="text-sm text-gray-600 mt-3">{result}</p>}
        </form>
        <p className="text-xs text-slate-500 mt-4">Set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID on the API server for real delivery. Without them, messages are logged to console.</p>
      </div>

      <div className="card-premium p-6">
        <h3 className="text-gray-900 font-bold mb-4">Send logs</h3>
        {loading ? <Spinner /> : (
          <DataTable
            columns={['To', 'Template', 'Status', 'Provider', 'Created']}
            rows={logs.map((l) => [
              l.to,
              <span key="t" className="font-mono text-xs">{l.template}</span>,
              <Badge key="s" tone={STATUS_BADGE[l.status] || 'default'}>{l.status}</Badge>,
              l.provider,
              new Date(l.createdAt).toLocaleString(),
            ])}
            empty="No WhatsApp messages sent yet."
          />
        )}
      </div>
    </div>
  );
}
