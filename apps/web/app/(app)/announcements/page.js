'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const AUDIENCES = [
  { value: 'all', label: 'Everyone' },
  { value: 'members', label: 'Members only' },
  { value: 'staff', label: 'Staff only' },
];
const CHANNELS = [
  { value: 'inapp', label: 'In-app' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

function ComposeForm({ onSend, sending }) {
  const [f, setF] = useState({ title: '', body: '', audience: 'all', channels: ['inapp'], pinned: false, expiresAt: '' });
  const toggle = (c) => setF({ ...f, channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c] });
  const submit = (e) => {
    e.preventDefault();
    // <input type="date"> gives YYYY-MM-DD; backend zod expects full ISO datetime
    onSend({ ...f, expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T23:59:59`).toISOString() : null });
  };
  return (
    <form onSubmit={submit}>
      <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={200} placeholder="e.g. Pool maintenance on Saturday" /></Field>
      <Field label="Message"><textarea className="input min-h-[120px]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required maxLength={5000} placeholder="Write your announcement…" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Audience">
          <select className="input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
            {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="Expires on (optional)">
          <input type="date" className="input [color-scheme:dark]" value={f.expiresAt} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 mb-4 text-sm text-gray-600 cursor-pointer">
        <input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} className="accent-teal-600 w-4 h-4" />
        📌 Pin to top of feed
      </label>
      <Field label="Channels">
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <label key={c.value} className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${f.channels.includes(c.value) ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
              <input type="checkbox" className="hidden" checked={f.channels.includes(c.value)} onChange={() => toggle(c.value)} />
              {c.label}
            </label>
          ))}
        </div>
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={sending || !f.channels.length}>
        {sending ? 'Sending…' : 'Send Announcement'}
      </button>
    </form>
  );
}

export default function AnnouncementsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'super_admin']);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/announcements')
      .then((d) => setList(d.announcements || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (!allowed) return <AccessDenied />;

  const send = async (data) => {
    setSending(true);
    setResult(null);
    try {
      const d = await api.post('/announcements', data);
      setResult(`Sent to ${d.recipients} recipient${d.recipients === 1 ? '' : 's'}${d.emailed ? ` (${d.emailed} emails)` : ''}.`);
      setShowForm(false);
      load();
    } catch (e) { setError(e.message); } finally { setSending(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    try { await api.del(`/announcements/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div>
      <PageHeader
        title="Announcements"
        sub="Broadcast messages to members and staff"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}>+ New Announcement</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {result && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">✅ {result}</div>}

      {loading ? <Spinner /> : list.length === 0 ? (
        <EmptyState title="No announcements yet" hint="Send your first broadcast to members and staff." />
      ) : (
        <div className="space-y-3">
          {list.map((a) => (
            <div key={a.id} className={`card-premium p-5 ${a.pinned ? 'border-teal-500/40 shadow-[0_0_24px_rgba(15,118,110,0.15)]' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.pinned && <Badge tone="violet">📌 Pinned</Badge>}
                    <h3 className="text-gray-900 font-semibold">{a.title}</h3>
                    {a.sentAt && <Badge tone="emerald">Sent</Badge>}
                    <Badge tone="slate">{AUDIENCES.find((x) => x.value === a.audience)?.label || a.audience}</Badge>
                    {a.expiresAt && <Badge tone="amber">Expires {new Date(a.expiresAt).toLocaleDateString()}</Badge>}
                  </div>
                  <p className="text-sm text-gray-500 mt-2 whitespace-pre-wrap">{a.body}</p>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {(a.channels || []).map((c) => <Badge key={c} tone="violet">{c}</Badge>)}
                    <span className="text-xs text-slate-500">
                      by {a.sender?.name || a.sender?.email || '—'} · {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <button onClick={() => remove(a.id)} className="text-xs text-red-700/70 hover:text-red-700 shrink-0">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title="New Announcement" onClose={() => setShowForm(false)}>
          <ComposeForm onSend={send} sending={sending} />
        </Modal>
      )}
    </div>
  );
}
