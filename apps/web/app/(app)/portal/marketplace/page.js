'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal, Field } from '../../../../components/ui';

const CATS = [
  { v: '', l: '🔍 Sab' },
  { v: 'service', l: '🛎️ Services' },
  { v: 'product', l: '📦 Products' },
  { v: 'job', l: '💼 Jobs' },
];

const CAT_TONE = { service: 'blue', product: 'violet', job: 'green' };
const CAT_LABEL = { service: 'Service', product: 'Product', job: 'Job' };

function fmtPrice(p) {
  if (p === null || p === undefined) return null;
  return 'Rs ' + Number(p).toLocaleString('en-PK');
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' min pehle';
  if (s < 86400) return Math.floor(s / 3600) + ' ghante pehle';
  return Math.floor(s / 86400) + ' din pehle';
}

export default function PortalMarketplacePage() {
  const [tab, setTab] = useState('all'); // all | mine
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showPost, setShowPost] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'service', price: '', description: '', contactInfo: '' });
  const [posting, setPosting] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (cat) params.set('category', cat);
    if (tab === 'mine') params.set('mine', '1');
    api.get('/marketplace?' + params.toString())
      .then((d) => setItems(d.listings || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [tab, cat]);
  // search debounce
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
      await api.post('/marketplace', {
        title: form.title.trim(),
        category: form.category,
        price: form.price === '' ? null : Number(form.price),
        description: form.description.trim() || null,
        contactInfo: form.contactInfo.trim() || null,
      });
      setShowPost(false);
      setForm({ title: '', category: 'service', price: '', description: '', contactInfo: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  };

  const markSold = async (id) => {
    if (!confirm('Is listing ko "sold" mark karein?')) return;
    try {
      await api.patch(`/marketplace/${id}`, { status: 'sold' });
      load();
    } catch (err) { setError(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Listing delete kar dein?')) return;
    try {
      await api.delete(`/marketplace/${id}`);
      load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <PageHeader
        title="Marketplace"
        sub="Community se khareedo, becho aur services do"
        actions={
          <button className="btn-primary" onClick={() => setShowPost(true)}>+ Listing post karein</button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
          {[{ v: 'all', l: 'Sab listings' }, { v: 'mine', l: 'Meri listings' }].map((t) => (
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
          placeholder="Search listings..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-2">
          {CATS.map((c) => (
            <button
              key={c.v}
              onClick={() => setCat(c.v)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${cat === c.v ? 'bg-blue-600/30 border-blue-500/50 text-white' : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'}`}
            >
              {c.l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Koi listing nahi mili" hint={tab === 'mine' ? 'Abhi tak aap ne koi listing post nahi ki.' : 'Pehli listing post karke shuruwat karein!'} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((l) => (
            <div key={l.id} className="card-premium p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <Badge tone={CAT_TONE[l.category] || 'slate'}>{CAT_LABEL[l.category] || l.category}</Badge>
                {l.status !== 'active' && (
                  <Badge tone={l.status === 'sold' ? 'amber' : 'slate'}>{l.status.toUpperCase()}</Badge>
                )}
              </div>
              <h3 className="text-base font-bold text-white mb-1">{l.title}</h3>
              {l.description && <p className="text-sm text-slate-300 mb-3 line-clamp-3">{l.description}</p>}
              <div className="mt-auto">
                {fmtPrice(l.price) && (
                  <div className="text-lg font-extrabold text-emerald-300 mb-2">{fmtPrice(l.price)}</div>
                )}
                <div className="text-xs text-slate-400 mb-1">
                  👤 {l.member?.name || 'Member'}{l.member?.companyName ? ` • ${l.member.companyName}` : ''}
                </div>
                {l.contactInfo && <div className="text-xs text-slate-300 mb-1">📞 {l.contactInfo}</div>}
                <div className="text-[11px] text-slate-500 mb-3">{timeAgo(l.createdAt)}</div>
                {tab === 'mine' && (
                  <div className="flex gap-2">
                    {l.status === 'active' && (
                      <button onClick={() => markSold(l.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600/20 border border-amber-500/40 text-amber-200 hover:bg-amber-600/30">
                        ✅ Sold mark karein
                      </button>
                    )}
                    <button onClick={() => remove(l.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/20 border border-red-500/40 text-red-200 hover:bg-red-600/30">
                      🗑️ Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showPost && (
        <Modal title="Nayi listing post karein" onClose={() => setShowPost(false)}>
          <form onSubmit={submit}>
            <Field label="Title">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} placeholder="e.g. Logo design service" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Category">
                <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="service">🛎️ Service</option>
                  <option value="product">📦 Product</option>
                  <option value="job">💼 Job</option>
                </select>
              </Field>
              <Field label="Price (Rs, optional)">
                <input type="number" min="0" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="5000" />
              </Field>
            </div>
            <Field label="Description">
              <textarea className="input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} placeholder="Tafseel likhein..." />
            </Field>
            <Field label="Contact info (optional)">
              <input className="input" value={form.contactInfo} onChange={(e) => setForm({ ...form, contactInfo: e.target.value })} maxLength={200} placeholder="Phone ya email" />
            </Field>
            <p className="text-xs text-slate-500 mb-4">Listing 30 din baad auto-expire ho jayegi.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setShowPost(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={posting}>{posting ? 'Posting...' : 'Post karein'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
