'use client';

// Phase 55 Track 8/10: Member Concierge Portal — service catalog + request form + my requests.
// Mount path: /portal/concierge (member portal; coordinator: Sidebar NAV_MEMBER me
//   { key: 'myconcierge', label: 'Concierge', path: '/portal/concierge', icon: 'workspaces' } jorein).
// Backend contracts — sibling track route files se VERIFY kiye gaye (disk par maujood):
//   GET  /api/concierge-services/active (?category=)  — { services: [{id,name,category,description,basePrice,provider}] }
//   POST /api/service-requests { serviceId?, title, details?, priority: low|normal|high|urgent } — 201 { id, status }
//   GET  /api/service-requests/me                    — { requests: [{id,title,details,status,priority,createdAt,service}] }
//   GET  /api/service-requests/me/:id                — { request }
//   POST /api/service-requests/me/:id/cancel         — { id, status }
//   GET  /api/request-messages/:requestId            — { requestId, messages }
//   POST /api/request-messages/:requestId { message } — created message
//   GET  /api/service-ratings/requests/:id          — { rating } (404 = no rating yet)
//   POST /api/service-ratings/requests/:id/rate { rating, comment? } — { rating }
// server.js/Sidebar.js untouched. Koi migration nahi. Deploy/push nahi — uncommitted.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../context/AuthContext';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal, Field } from '../../../../components/ui';

const STATUS_TONE = { new: 'blue', accepted: 'amber', in_progress: 'amber', done: 'green', cancelled: 'slate' };
const PRIORITY_TONE = { low: 'slate', normal: 'blue', high: 'amber', urgent: 'red' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CATEGORIES = ['all', 'errand', 'food', 'transport', 'wellness', 'business'];
const CAT_ICON = { errand: '📦', food: '🍽️', transport: '🚗', wellness: '💆', business: '💼' };

function arr(d, key) {
  if (Array.isArray(d?.[key])) return d[key];
  return Array.isArray(d) ? d : [];
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtPrice(p) {
  if (p === null || p === undefined || p === '') return 'Quote on request';
  const n = Number(p);
  return Number.isFinite(n) ? `PKR ${n.toLocaleString('en-PK')}` : String(p);
}

function Stars({ value, onPick, size = 'text-2xl' }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick && onPick(n)}
          className={`${size} ${n <= value ? 'text-amber-400' : 'text-gray-500'} ${onPick ? 'hover:scale-110 transition cursor-pointer' : ''}`}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const EMPTY_FORM = { serviceId: '', title: '', details: '', priority: 'normal' };

export default function PortalConciergePage() {
  const { user } = useAuth();
  const [services, setServices] = useState([]);
  const [requests, setRequests] = useState([]);
  const [ratings, setRatings] = useState({}); // requestId -> rating
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cat, setCat] = useState('all');
  const [tab, setTab] = useState('services'); // services | requests
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [rateId, setRateId] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [ratingBusy, setRatingBusy] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/concierge-services/active').then((d) => setServices(arr(d, 'services'))).catch(() => setServices([])),
      api.get('/service-requests/me').then((d) => setRequests(arr(d, 'requests'))).catch(() => setRequests([])),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Done requests ki existing ratings ek saath load karo (404 = abhi rate nahi hua)
  useEffect(() => {
    const done = requests.filter((r) => r.status === 'done');
    if (!done.length) return;
    Promise.all(done.map((r) => api.get(`/service-ratings/requests/${r.id}`).then((d) => [r.id, d.rating]).catch(() => [r.id, null])))
      .then((pairs) => setRatings(Object.fromEntries(pairs)));
  }, [requests]);

  const openForm = (service) => {
    setForm({ ...EMPTY_FORM, serviceId: service?.id || '', title: service ? `Request: ${service.name}` : '' });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const payload = {
        serviceId: form.serviceId || undefined,
        title: form.title,
        details: form.details || undefined,
        priority: form.priority,
      };
      await api.post('/service-requests', payload); // 201 { id, status }
      setForm(EMPTY_FORM);
      setShowForm(false);
      setMsg('Request sent. Our concierge team will take care of it.');
      const d = await api.get('/service-requests/me').catch(() => null);
      if (d) setRequests(arr(d, 'requests'));
    } catch (e2) {
      setMsg(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (r) => {
    if (!window.confirm('Cancel this request?')) return;
    try {
      const d = await api.post(`/service-requests/me/${r.id}/cancel`);
      setRequests((list) => list.map((x) => (x.id === r.id ? { ...x, status: d.status || 'cancelled' } : x)));
    } catch (e) {
      setMsg(e.message);
    }
  };

  const submitRating = async () => {
    if (!rateId || !rating) return;
    setRatingBusy(true);
    try {
      const d = await api.post(`/service-ratings/requests/${rateId}/rate`, { rating, comment: comment.trim() || undefined });
      setRatings((m) => ({ ...m, [rateId]: d.rating }));
      setRateId(null);
      setRating(0);
      setComment('');
      setMsg('Thanks for your feedback!');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setRatingBusy(false);
    }
  };

  if (loading) return <Spinner />;

  const filtered = cat === 'all' ? services : services.filter((s) => s.category === cat);
  const activeCount = requests.filter((r) => !['done', 'cancelled'].includes(r.status)).length;
  const doneCount = requests.filter((r) => r.status === 'done').length;

  return (
    <div>
      <PageHeader
        title="Concierge"
        sub="Lifestyle services at your desk — errands, food, transport and more"
        actions={<button className="btn-primary" onClick={() => openForm(null)}>+ New Request</button>}
      />
      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load(); }} />}
      {msg && <p className="text-sm text-emerald-700 mb-3">{msg}</p>}

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="card-premium p-4 text-center">
          <p className="text-2xl font-bold text-teal-700">{services.length}</p>
          <p className="text-xs text-gray-500">Services</p>
        </div>
        <div className="card-premium p-4 text-center">
          <p className="text-2xl font-bold text-amber-700">{activeCount}</p>
          <p className="text-xs text-gray-500">Active Requests</p>
        </div>
        <div className="card-premium p-4 text-center">
          <p className="text-2xl font-bold text-emerald-700">{doneCount}</p>
          <p className="text-xs text-gray-500">Completed</p>
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        {[
          { k: 'services', label: '🛎️ Services' },
          { k: 'requests', label: `📋 My Requests (${requests.length})` },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${tab === t.k ? 'bg-[#0f766e]/30 border border-[#0f766e]/50 text-teal-700' : 'bg-gray-100/50 border border-gray-200/50 text-gray-500 hover:text-gray-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'services' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${cat === c ? 'bg-[#0f766e]/30 border border-[#0f766e]/50 text-teal-700' : 'bg-gray-100/50 border border-gray-200/50 text-gray-500 hover:text-gray-800'}`}
              >
                {c === 'all' ? 'All' : `${CAT_ICON[c] || ''} ${c.charAt(0).toUpperCase() + c.slice(1)}`}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No services yet" hint="Concierge services will appear here once the team publishes the catalog." />
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((s) => (
                <div key={s.id} className="card-premium p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-2xl">{CAT_ICON[s.category] || '🛎️'}</span>
                    <Badge tone="slate">{s.category}</Badge>
                  </div>
                  <h3 className="font-bold text-gray-900 mb-1">{s.name}</h3>
                  {s.description && <p className="text-sm text-gray-500 line-clamp-2 mb-1">{s.description}</p>}
                  {s.provider?.name && <p className="text-xs text-slate-500 mb-3">by {s.provider.name}</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-teal-700">{fmtPrice(s.basePrice)}</span>
                    <button className="btn-primary text-sm px-4 py-1.5" onClick={() => openForm(s)}>Request</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div>
          {requests.length === 0 ? (
            <EmptyState title="No requests yet" hint="Pick a service above and we'll handle the rest — from coffee runs to airport pickups." />
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {requests.map((r) => {
                const myRating = ratings[r.id];
                return (
                  <div key={r.id} className="card-premium p-5">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <h3 className="font-bold text-gray-900">{r.title}</h3>
                        <p className="text-xs text-slate-500">{r.service?.name || 'Custom request'}</p>
                      </div>
                      <Badge tone={PRIORITY_TONE[r.priority] || 'slate'}>{r.priority}</Badge>
                    </div>
                    {r.details && <p className="text-sm text-gray-500 line-clamp-2 mb-3">{r.details}</p>}
                    <div className="flex items-center justify-between text-xs mb-3">
                      <span className="text-gray-500">{fmtDate(r.createdAt)}</span>
                      <Badge tone={STATUS_TONE[r.status] || 'slate'}>{(r.status || 'new').replace('_', ' ')}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/portal/concierge/${r.id}`} className="btn-secondary text-xs px-3 py-1.5">View & Chat</Link>
                      {r.status === 'new' && (
                        <button className="btn-secondary text-xs px-3 py-1.5 text-red-700" onClick={() => cancelRequest(r)}>Cancel</button>
                      )}
                      {r.status === 'done' && !myRating && (
                        <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setRateId(r.id)}>★ Rate</button>
                      )}
                      {myRating && (
                        <span className="text-xs text-amber-700 self-center">★ {myRating.rating}/5 rated</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <Modal title="New Concierge Request" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <Field label="Service (optional — pick a catalog service)">
              <select className="input" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
                <option value="">— Custom request —</option>
                {services.map((s) => <option key={s.id} value={s.id}>{CAT_ICON[s.category] || ''} {s.name} — {fmtPrice(s.basePrice)}</option>)}
              </select>
            </Field>
            <Field label="What do you need?">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={3} maxLength={120} placeholder="e.g. Pick up my dry cleaning from…" />
            </Field>
            <Field label="Details">
              <textarea className="input" rows={3} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Any specifics — addresses, quantities, time windows…" />
            </Field>
            <Field label="Priority">
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </Field>
            <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send Request'}</button>
          </form>
        </Modal>
      )}

      {rateId && (
        <Modal title="Rate this service" onClose={() => { setRateId(null); setRating(0); setComment(''); }}>
          <p className="text-sm text-gray-500 mb-3">How was the concierge service?</p>
          <Stars value={rating} onPick={setRating} />
          <Field label="Comment (optional)">
            <textarea className="input mt-3" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything we should know?" />
          </Field>
          <button onClick={submitRating} disabled={!rating || ratingBusy} className="btn-primary w-full mt-3 disabled:opacity-50">
            {ratingBusy ? 'Submitting…' : 'Submit Rating'}
          </button>
        </Modal>
      )}
    </div>
  );
}
