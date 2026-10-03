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

  const load = () => {
    setLoading(true);
    api.get('/whatsapp/logs')
      .then((d) => { setLogs(d.logs || []); setError(d.note || ''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
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
        <h3 className="text-white font-bold mb-4">Send message</h3>
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
          {result && <p className="text-sm text-slate-300 mt-3">{result}</p>}
        </form>
        <p className="text-xs text-slate-500 mt-4">Set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID on the API server for real delivery. Without them, messages are logged to console.</p>
      </div>

      <div className="card-premium p-6">
        <h3 className="text-white font-bold mb-4">Send logs</h3>
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
