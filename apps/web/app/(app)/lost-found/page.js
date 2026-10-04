'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const TYPE_TONE = { lost: 'red', found: 'green' };
const TYPE_LABEL = { lost: '🔍 Khoi hui', found: '📦 Mili hui' };
const STATUS_TONE = { open: 'blue', claimed: 'green', expired: 'slate' };

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' min pehle';
  if (s < 86400) return Math.floor(s / 3600) + ' ghante pehle';
  return Math.floor(s / 86400) + ' din pehle';
}

export default function LostFoundStaffPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'receptionist');
  const [tab, setTab] = useState('open'); // open | claimed | expired
  const [type, setType] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [claiming, setClaiming] = useState(null);
  const [claimForm, setClaimForm] = useState({ claimedBy: '', note: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('status', tab);
    if (type) params.set('type', type);
    if (q.trim()) params.set('q', q.trim());
    api.get('/lost-found?' + params.toString())
      .then((d) => setItems(d.items || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed, tab, type]);
  useEffect(() => {
    if (!allowed || loading) return;
    const t = setTimeout(load, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const openClaim = (it) => {
    setClaiming(it);
    setClaimForm({ claimedBy: it.member?.name || '', note: '' });
  };

  const submitClaim = async (e) => {
    e.preventDefault();
    if (!claimForm.claimedBy.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/lost-found/${claiming.id}/claim`, {
        claimedBy: claimForm.claimedBy.trim(),
        note: claimForm.note.trim() || null,
      });
      setClaiming(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (it) => {
    if (!confirm(`"${it.title}" delete kar dein?`)) return;
    try {
      await api.delete(`/lost-found/${it.id}`);
      load();
    } catch (err) { setError(err.message); }
  };

  if (roleLoading) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const counts = {
    open: items.filter((i) => i.status === 'open').length,
    claimed: items.filter((i) => i.status === 'claimed').length,
  };

  return (
    <div>
      <PageHeader title="Lost & Found" sub="Staff management — verify karke claimed mark karein" />

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Open items" value={counts.open} accent="blue" />
        <StatCard title="Claimed" value={counts.claimed} accent="green" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
          {[{ v: 'open', l: 'Open' }, { v: 'claimed', l: 'Claimed' }, { v: 'expired', l: 'Expired' }].map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${tab === t.v ? 'bg-[#7c3aed] text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]' : 'text-slate-300 hover:text-white'}`}
            >
              {t.l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {[{ v: '', l: 'Sab' }, { v: 'lost', l: '🔍 Lost' }, { v: 'found', l: '📦 Found' }].map((t) => (
            <button
              key={t.v}
              onClick={() => setType(t.v)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${type === t.v ? 'bg-[#7c3aed]/30 border-[#8b5cf6]/50 text-white' : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'}`}
            >
              {t.l}
            </button>
          ))}
        </div>
        <input className="input max-w-xs" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Koi item nahi" hint="Is tab me koi item nahi hai." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
          {items.map((it) => (
            <div key={it.id} className="card-premium p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <Badge tone={TYPE_TONE[it.type] || 'slate'}>{TYPE_LABEL[it.type] || it.type}</Badge>
                <Badge tone={STATUS_TONE[it.status] || 'slate'}>{it.status.toUpperCase()}</Badge>
              </div>
              <h3 className="text-base font-bold text-white mb-1">{it.title}</h3>
              {it.description && <p className="text-sm text-slate-300 mb-2 line-clamp-3">{it.description}</p>}
              {it.location && <div className="text-xs text-slate-400 mb-1">📍 {it.location}</div>}
              <div className="text-xs text-slate-400 mb-1">
                👤 {it.member?.name || 'Staff'}{it.member?.companyName ? ` • ${it.member.companyName}` : ''}
              </div>
              {it.status === 'claimed' && it.claimedBy && (
                <div className="text-xs text-emerald-300 mb-1">✅ Claimed by: {it.claimedBy}</div>
              )}
              <div className="text-[11px] text-slate-500 mb-3">{timeAgo(it.createdAt)}</div>
              <div className="mt-auto flex gap-2">
                {it.status === 'open' && (
                  <button onClick={() => openClaim(it)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-600/30">
                    ✅ Claim karein
                  </button>
                )}
                <button onClick={() => remove(it)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 border border-red-500/40 text-red-200 hover:bg-red-600/30">
                  🗑️ Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {claiming && (
        <Modal title={`Claim karein — ${claiming.title}`} onClose={() => setClaiming(null)}>
          <form onSubmit={submitClaim}>
            <Field label="Kis ko di? (name / member)">
              <input className="input" value={claimForm.claimedBy} onChange={(e) => setClaimForm({ ...claimForm, claimedBy: e.target.value })} required maxLength={120} placeholder="e.g. Ahmed Khan" />
            </Field>
            <Field label="Note (optional)">
              <input className="input" value={claimForm.note} onChange={(e) => setClaimForm({ ...claimForm, note: e.target.value })} maxLength={500} placeholder="ID verify ho gaya..." />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setClaiming(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Claimed mark karein'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
