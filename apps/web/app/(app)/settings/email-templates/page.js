'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Field, Spinner, ErrorBanner, Badge } from '../../../../components/ui';
import Link from 'next/link';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

export default function EmailTemplatesPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin']);
  const [list, setList] = useState([]);
  const [builtins, setBuiltins] = useState([]);
  const [selected, setSelected] = useState('');
  const [tpl, setTpl] = useState(null);
  const [form, setForm] = useState({ subject: '', htmlBody: '', isActive: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await api.get('/email-templates');
      setList(d.templates || []);
      setBuiltins(d.builtins || []);
      if (!selected && d.builtins && d.builtins.length) setSelected(d.builtins[0].key);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  useEffect(() => {
    if (!allowed || !selected) return;
    setError(''); setMsg(''); setPreview(false);
    api.get(`/email-templates/${encodeURIComponent(selected)}`)
      .then((d) => { setTpl(d); setForm({ subject: d.subject || '', htmlBody: d.htmlBody || '', isActive: d.isActive !== false }); })
      .catch((e) => setError(e.message));
  }, [selected, allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const customKeys = new Set(list.filter((t) => t.isActive !== undefined).map((t) => t.key));
  const activeMap = {};
  list.forEach((t) => { activeMap[t.key] = t.isActive; });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setMsg('');
    try {
      await api.put(`/email-templates/${encodeURIComponent(selected)}`, form);
      setMsg('Template saved. It will be used for future emails.');
      load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const resetDefault = async () => {
    if (!confirm('Delete the custom template and go back to the built-in default?')) return;
    setSaving(true); setError(''); setMsg('');
    try {
      await api.del(`/email-templates/${encodeURIComponent(selected)}`);
      setMsg('Reset to built-in default.');
      load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const seedDefaults = async () => {
    if (!confirm('Copy all 22 built-in templates into your workspace as editable defaults? Existing customizations will be kept.')) return;
    setSeeding(true); setError(''); setMsg('');
    try {
      const d = await api.post('/email-templates/seed');
      setMsg(`Seeded ${d.created} default templates (${d.total} total).`);
      load();
    } catch (err) { setError(err.message); }
    finally { setSeeding(false); }
  };

  const sendTest = async () => {
    if (!testEmail) { setError('Enter an email address to send the test to.'); return; }
    setTesting(true); setError(''); setMsg('');
    try {
      const d = await api.post(`/email-templates/${encodeURIComponent(selected)}/test`, { email: testEmail });
      setMsg(d.ok ? `Test email sent to ${testEmail}.` : `Test email not sent (${d.reason || 'unknown reason'}).`);
    } catch (err) { setError(err.message); }
    finally { setTesting(false); }
  };

  const insertVar = (v) => {
    const ta = document.getElementById('tpl-html');
    const token = `{{${v}}}`;
    if (ta && ta.selectionStart != null) {
      const s = ta.selectionStart, en = ta.selectionEnd;
      const next = form.htmlBody.slice(0, s) + token + form.htmlBody.slice(en);
      setForm({ ...form, htmlBody: next });
      setTimeout(() => { ta.focus(); ta.setSelectionRange(s + token.length, s + token.length); }, 0);
    } else {
      setForm({ ...form, htmlBody: form.htmlBody + token });
    }
  };

  const previewHtml = () => {
    let out = form.htmlBody;
    (tpl?.variables || []).forEach((v) => {
      out = out.replace(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`, 'g'), `<span style="background:#7c3aed33;border:1px dashed #7c3aed;padding:0 4px;border-radius:4px">[${v}]</span>`);
    });
    return out;
  };

  return (
    <div>
      <PageHeader title="Email Templates" sub="Customize the emails your workspace sends. Use {{variables}} — they are filled in automatically." />
      <div className="mb-4 rounded-xl bg-violet-500/10 border border-violet-400/30 px-4 py-3 text-sm text-violet-200">
        ⚙️ Want these emails sent automatically? Set up{' '}
        <Link href="/settings/lifecycle" className="underline font-semibold">Lifecycle Automation</Link>
        {' '}— trial ending, contract expiring, inactivity & overdue reminders.
      </div>
      {error && <ErrorBanner message={error} />}
      {msg && <div className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm px-4 py-2.5">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="card-premium p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">Templates</h3>
            <button type="button" className="text-[11px] text-blue-300 hover:text-blue-200 underline" onClick={seedDefaults} disabled={seeding}>
              {seeding ? 'Seeding…' : 'Seed all defaults'}
            </button>
          </div>
          <div className="space-y-1">
            {builtins.map((b) => (
              <button
                key={b.key}
                onClick={() => setSelected(b.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between ${selected === b.key ? 'bg-violet-500/20 text-white' : 'text-slate-300 hover:bg-white/5'}`}
              >
                <span className="font-mono text-xs">{b.key}</span>
                {activeMap[b.key] === true && customKeys.has(b.key) && <Badge tone="green">custom</Badge>}
                {activeMap[b.key] === false && <Badge tone="slate">off</Badge>}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 card-premium p-6">
          {!tpl ? <Spinner /> : (
            <form onSubmit={save}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white font-mono">{selected}</h3>
                <div className="flex items-center gap-2">
                  {tpl.custom
                    ? (tpl.isCustom ? <Badge tone="green">customized</Badge> : <Badge tone="blue">seeded default</Badge>)
                    : <Badge tone="slate">built-in default</Badge>}
                </div>
              </div>

              <Field label="Subject">
                <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required maxLength={200} />
              </Field>

              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">HTML body</label>
                <div className="flex flex-wrap gap-1">
                  {(tpl.variables || []).map((v) => (
                    <button key={v} type="button" onClick={() => insertVar(v)} className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 hover:bg-violet-500/30 font-mono">{`{{${v}}}`}</button>
                  ))}
                </div>
              </div>
              <textarea id="tpl-html" className="input font-mono text-xs" rows={14} value={form.htmlBody} onChange={(e) => setForm({ ...form, htmlBody: e.target.value })} required />

              <label className="flex items-center gap-2 mt-4 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 accent-violet-500" />
                Use this custom template (uncheck to fall back to built-in without deleting)
              </label>

              <div className="flex flex-wrap gap-2 mt-6">
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button>
                <button type="button" className="btn-secondary" onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Preview'}</button>
                {tpl.custom && <button type="button" className="btn-danger" onClick={resetDefault} disabled={saving}>Reset to default</button>}
              </div>

              <div className="mt-6 rounded-xl border border-white/10 p-4">
                <h4 className="text-xs font-semibold text-slate-300 mb-2">SEND TEST EMAIL</h4>
                <div className="flex flex-wrap gap-2">
                  <input className="input flex-1 min-w-[200px]" type="email" placeholder="you@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                  <button type="button" className="btn-secondary" onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send test'}</button>
                </div>
                <p className="text-xs text-slate-500 mt-2">Sends this template with sample data (e.g. {"{{memberName}}"} → Ali Raza).</p>
              </div>

              {preview && (
                <div className="mt-6">
                  <h4 className="text-xs font-semibold text-slate-400 mb-2">PREVIEW (variables highlighted)</h4>
                  <div className="rounded-xl border border-white/10 bg-[#0a0a14] p-4 text-sm text-slate-200" dangerouslySetInnerHTML={{ __html: previewHtml() }} />
                  <p className="text-xs text-slate-500 mt-2">Subject preview: <span className="text-slate-300">{form.subject}</span></p>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
