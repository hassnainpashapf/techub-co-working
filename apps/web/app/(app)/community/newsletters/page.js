'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const STATUS_TONE = { draft: 'slate', scheduled: 'blue', sending: 'amber', sent: 'green' };
const SEGMENTS = [
  { value: 'all', label: 'All members' },
  { value: 'active', label: 'Active members' },
  { value: 'new', label: 'New members (last 30 days)' },
  { value: 'events', label: 'Event-goers (last 90 days)' },
];
const BLOCK_TYPES = [
  { value: 'heading', label: 'Heading' },
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'event', label: 'Event link' },
];

function uid() { return Math.random().toString(36).slice(2, 10); }

function renderBlockPreview(s) {
  if (s.type === 'heading') return <h3 className="text-xl font-bold">{s.heading || 'Heading…'}</h3>;
  if (s.type === 'text') return <p className="whitespace-pre-wrap text-sm">{s.text || 'Text…'}</p>;
  if (s.type === 'image') return s.imageUrl
    ? <img src={s.imageUrl} alt={s.imageAlt} className="max-w-full rounded-lg" />
    : <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-400">Image URL…</div>;
  if (s.type === 'event') return <div className="rounded-lg border p-3 text-sm">📅 Event: {s.eventTitle || 'Event title…'}</div>;
  return null;
}

function NewsletterForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    title: initial?.title || '',
    subject: initial?.subject || '',
    segment: initial?.segment || 'all',
    sections: (initial?.sections || []).map((s) => ({ ...s, id: s.id || uid() })),
  });

  const addBlock = (type) => setF((p) => ({
    ...p,
    sections: [...p.sections, { id: uid(), type, heading: '', text: '', imageUrl: '', imageAlt: '', eventId: '', eventTitle: '' }],
  }));
  const updBlock = (id, patch) => setF((p) => ({
    ...p, sections: p.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }));
  const delBlock = (id) => setF((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== id) }));
  const moveBlock = (id, dir) => setF((p) => {
    const i = p.sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.sections.length) return p;
    const arr = [...p.sections];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...p, sections: arr };
  });

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({ title: f.title, subject: f.subject, segment: f.segment, sections: f.sections });
    }}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Newsletter title *">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={200} />
        </Field>
        <Field label="Audience">
          <select className="input" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })}>
            {SEGMENTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Subject * — use {{name}} for personalization">
        <input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required maxLength={300} />
      </Field>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Content blocks</span>
        <div className="flex gap-1">
          {BLOCK_TYPES.map((t) => (
            <button key={t.value} type="button" className="btn-outline btn-sm" onClick={() => addBlock(t.value)}>+ {t.label}</button>
          ))}
        </div>
      </div>

      {f.sections.length === 0 && <p className="mb-3 text-sm text-slate-400">No blocks yet — add one above.</p>}
      <div className="space-y-3">
        {f.sections.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{BLOCK_TYPES.find((t) => t.value === s.type)?.label} #{i + 1}</span>
              <div className="flex gap-1">
                <button type="button" className="btn-outline btn-sm" onClick={() => moveBlock(s.id, -1)}>↑</button>
                <button type="button" className="btn-outline btn-sm" onClick={() => moveBlock(s.id, 1)}>↓</button>
                <button type="button" className="btn-outline btn-sm" onClick={() => delBlock(s.id)}>✕</button>
              </div>
            </div>
            {s.type === 'heading' && <input className="input" value={s.heading} onChange={(e) => updBlock(s.id, { heading: e.target.value })} placeholder="Heading text" />}
            {s.type === 'text' && <textarea className="input" rows={4} value={s.text} onChange={(e) => updBlock(s.id, { text: e.target.value })} placeholder="Paragraph text (blank line = new paragraph)" />}
            {s.type === 'image' && (
              <div className="grid gap-2 md:grid-cols-2">
                <input className="input" value={s.imageUrl} onChange={(e) => updBlock(s.id, { imageUrl: e.target.value })} placeholder="Image URL" />
                <input className="input" value={s.imageAlt} onChange={(e) => updBlock(s.id, { imageAlt: e.target.value })} placeholder="Alt text" />
              </div>
            )}
            {s.type === 'event' && <input className="input" value={s.eventTitle} onChange={(e) => updBlock(s.id, { eventTitle: e.target.value })} placeholder="Event title (link text)" />}
            <div className="mt-2 rounded-lg bg-black/30 p-3">{renderBlockPreview(s)}</div>
          </div>
        ))}
      </div>

      <button className="btn-primary mt-4 w-full" disabled={saving}>{saving ? 'Saving…' : 'Save newsletter'}</button>
    </form>
  );
}

export default function NewslettersPage() {
  const gate = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState(null);
  const [schedId, setSchedId] = useState(null);
  const [schedAt, setSchedAt] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await api.get('/newsletters');
      setRows(d.newsletters || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (gate === 'ok') load(); }, [gate]);

  if (gate === 'loading') return <div className="p-8"><Spinner /></div>;
  if (gate === 'denied') return <AccessDenied />;

  const save = async (data) => {
    setSaving(true);
    try {
      if (editing) await api.patch(`/newsletters/${editing.id}`, data);
      else await api.post('/newsletters', data);
      setShowForm(false); setEditing(null); load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const sendNow = async (id) => {
    if (!confirm('Send this newsletter to all recipients in the segment now?')) return;
    try {
      const d = await api.post(`/newsletters/${id}/send`);
      setNotice(`Sending started — ${d.recipients} recipients queued.`);
      load();
    } catch (e) { setError(e.message); }
  };

  const schedule = async (id) => {
    if (!schedAt) { setError('Pick a date/time first'); return; }
    try {
      await api.post(`/newsletters/${id}/schedule`, { scheduledFor: new Date(schedAt).toISOString() });
      setSchedId(null); setSchedAt(''); setNotice('Newsletter scheduled.');
      load();
    } catch (e) { setError(e.message); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this newsletter?')) return;
    try { await api.delete(`/newsletters/${id}`); load(); } catch (e) { setError(e.message); }
  };

  const viewStats = async (id) => {
    try {
      const d = await api.get(`/newsletters/${id}/stats`);
      setStats(d.stats);
    } catch (e) { setError(e.message); }
  };

  const sent = rows.filter((r) => r.status === 'sent').length;

  return (
    <div className="p-6">
      <PageHeader title="Member Newsletters" subtitle="Block-based newsletter builder with segments and scheduling">
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New newsletter</button>
      </PageHeader>

      {notice && <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-200">{notice}</div>}
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard title="Total newsletters" value={rows.length} />
        <StatCard title="Sent" value={sent} />
        <StatCard title="Emails sent (last batch)" value={rows.reduce((a, r) => a + (r.sentCount || 0), 0)} />
      </div>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="No newsletters yet" subtitle="Create your first member newsletter." action={{ label: 'New newsletter', onClick: () => setShowForm(true) }} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400">
              <th className="p-3">Title</th><th className="p-3">Segment</th><th className="p-3">Status</th>
              <th className="p-3">Recipients</th><th className="p-3">Sent</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="p-3 font-semibold">{r.title}<div className="text-xs font-normal text-slate-400">{r.subject}</div></td>
                  <td className="p-3">{SEGMENTS.find((s) => s.value === r.segment)?.label || r.segment}</td>
                  <td className="p-3"><Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status}</Badge></td>
                  <td className="p-3">{r.recipientCount}</td>
                  <td className="p-3">{r.sentCount}</td>
                  <td className="p-3"><div className="flex flex-wrap gap-1">
                    {r.status === 'draft' && <>
                      <button className="btn-outline btn-sm" onClick={() => { setEditing(r); setShowForm(true); }}>Edit</button>
                      <button className="btn-outline btn-sm" onClick={() => setSchedId(r.id)}>Schedule</button>
                      <button className="btn-primary btn-sm" onClick={() => sendNow(r.id)}>Send now</button>
                      <button className="btn-outline btn-sm" onClick={() => remove(r.id)}>Delete</button>
                    </>}
                    {['sent', 'sending'].includes(r.status) && <button className="btn-outline btn-sm" onClick={() => viewStats(r.id)}>Stats</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal title={editing ? 'Edit newsletter' : 'New newsletter'} onClose={() => { setShowForm(false); setEditing(null); }} wide>
          <NewsletterForm initial={editing} onSave={save} saving={saving} />
        </Modal>
      )}

      {schedId && (
        <Modal title="Schedule newsletter" onClose={() => { setSchedId(null); setSchedAt(''); }}>
          <Field label="Send at *">
            <input type="datetime-local" className="input" value={schedAt} onChange={(e) => setSchedAt(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" onClick={() => schedule(schedId)}>Schedule</button>
        </Modal>
      )}

      {stats && (
        <Modal title="Newsletter stats" onClose={() => setStats(null)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard title="Recipients" value={stats.recipients} />
            <StatCard title="Sent" value={stats.sent} />
            <StatCard title="Unsubscribed (tenant)" value={stats.unsubscribed} />
          </div>
          <p className="mt-3 text-xs text-slate-400">Open tracking not collected. {stats.openRateEstimate}</p>
        </Modal>
      )}
    </div>
  );
}
