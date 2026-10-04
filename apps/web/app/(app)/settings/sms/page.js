'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Field, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function StatusBadge({ status }) {
  const cls = status === 'sent'
    ? 'bg-emerald-500/15 text-emerald-700 border-emerald-200'
    : status === 'failed'
      ? 'bg-red-500/15 text-red-700 border-red-200'
      : 'bg-amber-500/15 text-amber-700 border-amber-200';
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>;
}

export default function SmsSettingsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'finance']);
  const [form, setForm] = useState({ to: '', body: '' });
  const [logs, setLogs] = useState([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const loadLogs = () => {
    api.get('/sms/logs')
      .then((d) => { setLogs(d.logs || []); setConfigured(!!d.configured); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (allowed) loadLogs(); }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const send = async (e) => {
    e.preventDefault();
    setSending(true); setError(''); setMsg('');
    try {
      const d = await api.post('/sms/send', form);
      setMsg(d.result?.provider === 'console'
        ? 'Logged (console mode — Twilio not configured).'
        : 'SMS sent!');
      setForm({ to: '', body: '' });
      loadLogs();
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  };

  const chars = form.body.length;

  return (
    <div>
      <PageHeader title="SMS Notifications" subtitle={configured ? 'Twilio connected' : 'Twilio not configured — messages are logged to console (dev mode)'} />

      {error && <ErrorBanner message={error} />}
      {msg && <div className="mb-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">{msg}</div>}

      <div className="card-premium p-6 mb-3">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Send SMS</h2>
        <form onSubmit={send}>
          <Field label="To (phone number)">
            <input className="input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="+92 300 1234567" required />
          </Field>
          <Field label={`Message (${chars}/1600)`}>
            <textarea className="input min-h-[100px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Type your message…" required maxLength={1600} />
          </Field>
          <button type="submit" className="btn-primary" disabled={sending}>{sending ? 'Sending…' : 'Send SMS'}</button>
        </form>
      </div>

      <div className="card-premium p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Recent messages</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500">No messages yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4">To</th>
                  <th className="py-2 pr-4">Message</th>
                  <th className="py-2 pr-4">Provider</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-gray-200 text-gray-600">
                    <td className="py-2 pr-4 font-medium text-gray-900">{l.to}</td>
                    <td className="py-2 pr-4 max-w-[280px] truncate" title={l.body}>{l.body}</td>
                    <td className="py-2 pr-4 text-gray-500">{l.provider}</td>
                    <td className="py-2 pr-4"><StatusBadge status={l.status} /></td>
                    <td className="py-2 text-gray-500">{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
