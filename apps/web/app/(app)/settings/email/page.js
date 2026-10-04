'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Field, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

export default function EmailSettingsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin']);
  const [form, setForm] = useState({ enabled: false, host: '', port: 587, secure: false, username: '', password: '', fromName: '', fromEmail: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    api.get('/email-settings')
      .then((d) => { if (d.settings) setForm({ ...form, ...d.settings, password: '' }); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setMsg('');
    try {
      const payload = { ...form, port: Number(form.port) };
      if (!payload.password) delete payload.password;
      await api.put('/email-settings', payload);
      setMsg('Settings saved.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!testEmail) return;
    setTesting(true); setError(''); setMsg('');
    try {
      const d = await api.post('/email-settings/test', { to: testEmail });
      setMsg(d.result?.sent ? 'Test email sent! Check your inbox.' : `Not sent: ${d.result?.reason || 'unknown'}`);
    } catch (err) { setError(err.message); }
    finally { setTesting(false); }
  };

  const f = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }) });

  return (
    <div className="max-w-2xl">
      <PageHeader title="Email Settings" subtitle="SMTP configuration for automatic notifications" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {msg && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div>}
      {loading ? <Spinner /> : (
        <form onSubmit={save} className="card-premium p-6 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-4 h-4 accent-teal-600" />
            <span className="text-sm font-medium text-gray-900">Enable email notifications</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SMTP host"><input className="input" placeholder="smtp.gmail.com" {...f('host')} /></Field>
            <Field label="Port"><input type="number" className="input" {...f('port')} /></Field>
            <Field label="Username"><input className="input" placeholder="you@example.com" {...f('username')} /></Field>
            <Field label="Password"><input type="password" className="input" placeholder={form.password ? '' : '•••••••• (unchanged)'} {...f('password')} /></Field>
            <Field label="From name"><input className="input" placeholder="Techub Studio" {...f('fromName')} /></Field>
            <Field label="From email"><input type="email" className="input" placeholder="noreply@techub.co" {...f('fromEmail')} /></Field>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.target.checked })} className="w-4 h-4 accent-teal-600" />
            <span className="text-sm text-gray-600">Use SSL/TLS (port 465)</span>
          </label>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>

          <div className="pt-4 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Send test email</h3>
            <div className="flex gap-2">
              <input type="email" className="input flex-1" placeholder="test@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
              <button type="button" className="btn-secondary" onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send test'}</button>
            </div>
          </div>

          <div className="pt-2 text-xs text-slate-500">
            Automatic emails: booking confirmed · ticket status changed · visitor check-in (host) · payment received
          </div>
        </form>
      )}
    </div>
  );
}
