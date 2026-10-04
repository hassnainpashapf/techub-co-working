'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal, Field } from '../../../../components/ui';

const TYPE_TONE = { lost: 'red', found: 'green' };
const TYPE_LABEL = { lost: '🔍 Khoi hui', found: '📦 Mili hui' };

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' min pehle';
  if (s < 86400) return Math.floor(s / 3600) + ' ghante pehle';
  return Math.floor(s / 86400) + ' din pehle';
}

export default function PortalLostFoundPage() {
  const [tab, setTab] = useState('all'); // all | lost | found
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [form, setForm] = useState({ type: 'lost', title: '', description: '', location: '', imageUrl: '' });
  const [posting, setPosting] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (tab === 'lost' || tab === 'found') params.set('type', tab);
    api.get('/lost-found?' + params.toString())
      .then((d) => setItems(d.items || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [tab]);
  useEffect(() => {
    const t = setTimeout(() => { if (!loading) load(); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setPosting(true);
    setError('');
    try {
      await api.post('/lost-found', {
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim() || null,
        location: form.location.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
      });
      setShowReport(false);
      setForm({ type: 'lost', title: '', description: '', location: '', imageUrl: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Lost & Found"
        sub="Khoi hui cheez report karein ya mili hui cheez jama karwayein"
        actions={
          <button className="btn-primary" onClick={() => setShowReport(true)}>+ Report karein</button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
          {[{ v: 'all', l: 'Sab' }, { v: 'lost', l: '🔍 Khoi hui' }, { v: 'found', l: '📦 Mili hui' }].map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${tab === t.v ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.4)]' : 'text-slate-300 hover:text-white'}`}
            >
              {t.l}
            </button>
          ))}
        </div>
        <input
          className="input max-w-xs"
          placeholder="Search items..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Koi item nahi mili" hint="Khoi ya mili hui cheez report karke shuruwat karein." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
          {items.map((it) => (
            <div key={it.id} className="card-premium p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <Badge tone={TYPE_TONE[it.type] || 'slate'}>{TYPE_LABEL[it.type] || it.type}</Badge>
                {it.status !== 'open' && <Badge tone="amber">{it.status.toUpperCase()}</Badge>}
              </div>
              <h3 className="text-base font-bold text-white mb-1">{it.title}</h3>
              {it.description && <p className="text-sm text-slate-300 mb-2 line-clamp-3">{it.description}</p>}
              {it.location && <div className="text-xs text-slate-400 mb-1">📍 {it.location}</div>}
              <div className="mt-auto">
                <div className="text-xs text-slate-400 mb-1">
                  👤 {it.member?.name || 'Staff'}{it.member?.companyName ? ` • ${it.member.companyName}` : ''}
                </div>
                <div className="text-[11px] text-slate-500">{timeAgo(it.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showReport && (
        <Modal title="Lost / Found report karein" onClose={() => setShowReport(false)}>
          <form onSubmit={submit}>
            <Field label="Type">
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="lost">🔍 Khoi hui (meri cheez ghum gayi)</option>
                <option value="found">📦 Mili hui (mujhe kisi ki cheez mili)</option>
              </select>
            </Field>
            <Field label="Cheez ka naam">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} placeholder="e.g. Black leather wallet" />
            </Field>
            <Field label="Location (kahan?)">
              <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={200} placeholder="e.g. Meeting Room B ke paas" />
            </Field>
            <Field label="Description">
              <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} placeholder="Rang, brand, nishani waghera..." />
            </Field>
            <Field label="Image URL (optional)">
              <input className="input" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} maxLength={1000} placeholder="https://..." />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setShowReport(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={posting}>{posting ? 'Saving...' : 'Report karein'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
