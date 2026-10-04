'use client';

// Phase 55 Track 8/10: Concierge request detail — timeline, chat, rating widget.
// Mount path: /portal/concierge/[id].
// Backend contracts — sibling track route files se VERIFY kiye gaye (disk par maujood):
//   GET  /api/service-requests/me/:id             — { request } (service included)
//   GET  /api/request-messages/:requestId         — { requestId, messages: [{id,message,sender:{id,name,role},createdAt}] }
//   POST /api/request-messages/:requestId { message } — created message
//   GET  /api/service-ratings/requests/:id       — { rating } (404 = no rating yet)
//   POST /api/service-ratings/requests/:id/rate { rating, comment? } — { rating }
//   POST /api/service-requests/me/:id/cancel     — { id, status }
// server.js/Sidebar.js untouched. Koi migration nahi. Deploy/push nahi — uncommitted.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../../lib/api';
import { useAuth } from '../../../../../context/AuthContext';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Field } from '../../../../../components/ui';

const STATUS_TONE = { new: 'blue', accepted: 'amber', in_progress: 'amber', done: 'green', cancelled: 'slate' };
const STEPS = [
  { key: 'new', label: 'Received' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

function arr(d, key) {
  if (Array.isArray(d?.[key])) return d[key];
  return Array.isArray(d) ? d : [];
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Stars({ value, onPick, size = 'text-2xl' }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick && onPick(n)}
          className={`${size} ${n <= value ? 'text-amber-400' : 'text-slate-600'} ${onPick ? 'hover:scale-110 transition cursor-pointer' : ''}`}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// Defensive timeline: server events ya status timestamps se banao.
function buildTimeline(r) {
  const events = arr(r, 'timeline');
  if (events.length) return events.map((e) => ({
    at: e.at || e.createdAt,
    label: e.label || e.status || 'Update',
    note: e.note || e.message || '',
  }));
  const tl = [{ at: r.createdAt, label: 'Request received', note: '' }];
  if (r.status === 'cancelled') {
    tl.push({ at: r.updatedAt, label: 'Cancelled', note: '' });
    return tl;
  }
  if (r.acceptedAt) tl.push({ at: r.acceptedAt, label: 'Accepted by team', note: r.assignee?.name ? `Assigned to ${r.assignee.name}` : '' });
  else if (r.status !== 'new') tl.push({ at: r.updatedAt, label: 'In progress', note: '' });
  if (r.completedAt) tl.push({ at: r.completedAt, label: 'Completed', note: '' });
  return tl;
}

export default function ConciergeRequestDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [req, setReq] = useState(null);
  const [messages, setMessages] = useState([]);
  const [myRating, setMyRating] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [msgBusy, setMsgBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [ratingBusy, setRatingBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get(`/service-requests/me/${id}`).then((d) => d.request || d),
      api.get(`/request-messages/${id}`).then((d) => arr(d, 'messages')).catch(() => []),
      api.get(`/service-ratings/requests/${id}`).then((d) => d.rating).catch(() => null),
    ])
      .then(([r, ms, rt]) => {
        setReq(r);
        setMessages(ms);
        setMyRating(rt);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!msg.trim()) return;
    setMsgBusy(true);
    try {
      const d = await api.post(`/request-messages/${id}`, { message: msg.trim() });
      setMessages((list) => [...list, d.message || d]);
      setMsg('');
    } catch (e2) {
      setError(e2.message);
    } finally {
      setMsgBusy(false);
    }
  };

  const submitRating = async () => {
    if (!rating) return;
    setRatingBusy(true);
    try {
      const d = await api.post(`/service-ratings/requests/${id}/rate`, { rating, comment: comment.trim() || undefined });
      setMyRating(d.rating);
    } catch (e) {
      setError(e.message);
    } finally {
      setRatingBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (!window.confirm('Cancel this request?')) return;
    try {
      const d = await api.post(`/service-requests/me/${id}/cancel`);
      setReq((r) => ({ ...r, status: d.status || 'cancelled' }));
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <Spinner />;
  if (error && !req) {
    return (
      <div>
        <Link href="/portal/concierge" className="text-sm text-blue-400 hover:text-blue-300">← Back to Concierge</Link>
        <ErrorBanner message={error} onRetry={load} />
      </div>
    );
  }
  if (!req) return <EmptyState title="Request not found" hint="This request may have been removed." />;

  const timeline = buildTimeline(req);
  const stepIdx = req.status === 'cancelled' ? -1 : STEPS.findIndex((s) => s.key === req.status);
  const canChat = !['done', 'cancelled'].includes(req.status);

  return (
    <div>
      <Link href="/portal/concierge" className="text-sm text-blue-400 hover:text-blue-300">← Back to Concierge</Link>
      <div className="mt-2">
        <PageHeader
          title={req.title || 'Concierge Request'}
          sub={`${req.service?.name || 'Custom request'}${req.service?.category ? ` · ${req.service.category}` : ''} · ${fmtDate(req.createdAt)}`}
          actions={req.status === 'new' ? <button className="btn-secondary text-sm px-3 py-1.5 text-red-300" onClick={cancelRequest}>Cancel Request</button> : null}
        />
      </div>
      {error && <ErrorBanner message={error} onRetry={() => setError('')} />}

      <div className="flex flex-wrap gap-2 mb-4 text-xs items-center">
        <Badge tone={STATUS_TONE[req.status] || 'slate'}>{(req.status || 'new').replace('_', ' ')}</Badge>
        {req.priority && <Badge tone={req.priority === 'urgent' ? 'red' : 'slate'}>{req.priority}</Badge>}
        {req.assignee?.name && <span className="text-slate-400">Assigned: {req.assignee.name}</span>}
        {req.price != null && <span className="text-blue-300 font-semibold">PKR {Number(req.price).toLocaleString('en-PK')}</span>}
      </div>

      {req.details && (
        <div className="card-premium p-4 mb-5">
          <p className="text-sm text-slate-200 whitespace-pre-wrap">{req.details}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="card-premium p-5 mb-5">
        <h3 className="font-bold text-white mb-4">📍 Request Timeline</h3>
        <div className="flex gap-1 mb-5">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex-1">
              <div className={`h-1.5 rounded-full ${stepIdx >= 0 && i <= stepIdx ? 'bg-blue-500' : 'bg-slate-700'}`} />
              <p className={`text-[11px] mt-1 ${stepIdx >= 0 && i <= stepIdx ? 'text-blue-300' : 'text-slate-500'}`}>{s.label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {timeline.map((t, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-400 mt-1" />
                {i < timeline.length - 1 && <div className="w-px flex-1 bg-slate-700/60" />}
              </div>
              <div className="pb-3">
                <p className="text-sm font-semibold text-white">{t.label}</p>
                {t.note && <p className="text-xs text-slate-400">{t.note}</p>}
                <p className="text-xs text-slate-500">{fmtDate(t.at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Chat */}
        <div className="card-premium p-5">
          <h3 className="font-bold text-white mb-4">💬 Chat with Concierge</h3>
          <div className="space-y-3 max-h-80 overflow-y-auto mb-4 pr-1">
            {messages.map((m) => {
              const mine = user && (m.sender?.id === user.id || m.senderId === user.id);
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 ${mine ? 'bg-blue-600/30 border border-blue-500/30' : 'bg-slate-800/60 border border-slate-700/50'}`}>
                    <p className="text-xs text-slate-400 mb-0.5">{m.sender?.name || (mine ? 'You' : 'Concierge')} · {fmtDate(m.createdAt)}</p>
                    <p className="text-sm text-slate-100 whitespace-pre-wrap">{m.message || m.body}</p>
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && (
              <p className="text-sm text-slate-500">No messages yet — say hello to the concierge team.</p>
            )}
          </div>
          {canChat ? (
            <form onSubmit={sendMessage}>
              <Field label="Send a message">
                <textarea className="input" rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type your message…" required />
              </Field>
              <button type="submit" className="btn-primary w-full" disabled={msgBusy || !msg.trim()}>
                {msgBusy ? 'Sending…' : 'Send'}
              </button>
            </form>
          ) : (
            <p className="text-xs text-slate-500">This request is {req.status} — chat is closed.</p>
          )}
        </div>

        {/* Rating */}
        <div className="card-premium p-5">
          <h3 className="font-bold text-white mb-4">⭐ Rate the Service</h3>
          {req.status !== 'done' ? (
            <p className="text-sm text-slate-500">Once your request is completed, you can rate the service here.</p>
          ) : myRating ? (
            <div>
              <Stars value={myRating.rating} />
              <p className="text-sm text-amber-200 mt-2">Thanks for rating this service!</p>
              {myRating.comment && <p className="text-sm text-slate-400 mt-1">"{myRating.comment}"</p>}
            </div>
          ) : (
            <div>
              <p className="text-sm text-slate-400 mb-3">Your request is complete. How was it?</p>
              <Stars value={rating} onPick={setRating} />
              <Field label="Comment (optional)">
                <textarea className="input mt-3" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything we should know?" />
              </Field>
              <button onClick={submitRating} disabled={!rating || ratingBusy} className="btn-primary w-full mt-3 disabled:opacity-50">
                {ratingBusy ? 'Submitting…' : 'Submit Rating'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
