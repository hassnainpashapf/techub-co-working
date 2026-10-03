'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../context/AuthContext';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal, Field } from '../../../../components/ui';

const PRIORITY_TONE = { low: 'slate', medium: 'blue', high: 'amber', urgent: 'red' };
const STATUS_TONE = { open: 'blue', in_progress: 'amber', on_hold: 'slate', resolved: 'green', closed: 'slate' };
const CATEGORIES = ['maintenance', 'billing', 'it', 'housekeeping', 'security', 'general'];

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Rating is stored as a regular comment with a [RATING:n] marker (no migration).
function parseRating(body) {
  const m = /^(\[RATING:(\d)\])\s*/.exec(body || '');
  if (!m) return null;
  const n = parseInt(m[2], 10);
  return (n >= 1 && n <= 5) ? n : null;
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

const EMPTY_FORM = { title: '', description: '', category: 'general', priority: 'medium', unitId: '' };

export default function PortalSupportPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingBusy, setRatingBusy] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/tickets').then((d) => setTickets(d.tickets || [])),
      api.get('/spaces/units').then((d) => setUnits(d.units || [])).catch(() => {}),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openDetail = async (id) => {
    setDetailId(id);
    setDetail(null);
    setReply('');
    setRating(0);
    setDetailLoading(true);
    try {
      const d = await api.get(`/tickets/${id}`);
      setDetail(d.ticket);
    } catch (e) {
      setDetail({ error: e.message });
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (id) => {
    const d = await api.get(`/tickets/${id}`);
    setDetail(d.ticket);
    setTickets((list) => list.map((t) => (t.id === id ? { ...t, updatedAt: d.ticket.updatedAt, status: d.ticket.status, _count: d.ticket._count } : t)));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const payload = {
        title: form.title,
        description: form.description || undefined,
        category: form.category,
        priority: form.priority,
        unitId: form.unitId || undefined,
      };
      const d = await api.post('/tickets', payload);
      setTickets((list) => [d.ticket, ...list]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      setMsg('Ticket raised. Our team will get back to you soon.');
    } catch (e2) {
      setMsg(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setReplyBusy(true);
    try {
      await api.post(`/tickets/${detailId}/comments`, { body: reply.trim() });
      setReply('');
      await refreshDetail(detailId);
    } catch (e2) {
      setDetail((d) => ({ ...d, replyError: e2.message }));
    } finally {
      setReplyBusy(false);
    }
  };

  const submitRating = async () => {
    if (!rating) return;
    setRatingBusy(true);
    try {
      await api.post(`/tickets/${detailId}/comments`, { body: `[RATING:${rating}] ★ Rated ${rating}/5` });
      setRating(0);
      await refreshDetail(detailId);
    } finally {
      setRatingBusy(false);
    }
  };

  if (loading) return <Spinner />;

  const openCount = tickets.filter((t) => t.status === 'open').length;
  const progCount = tickets.filter((t) => t.status === 'in_progress').length;
  const resCount = tickets.filter((t) => ['resolved', 'closed'].includes(t.status)).length;

  return (
    <div>
      <PageHeader
        title="Support"
        sub="Raise a ticket and chat with our team"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Raise Ticket</button>}
      />
      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load(); }} />}
      {msg && <p className="text-sm text-emerald-300 mb-3">{msg}</p>}

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="card-premium p-4 text-center">
          <p className="text-2xl font-bold text-blue-300">{openCount}</p>
          <p className="text-xs text-slate-400">Open</p>
        </div>
        <div className="card-premium p-4 text-center">
          <p className="text-2xl font-bold text-amber-300">{progCount}</p>
          <p className="text-xs text-slate-400">In Progress</p>
        </div>
        <div className="card-premium p-4 text-center">
          <p className="text-2xl font-bold text-emerald-300">{resCount}</p>
          <p className="text-xs text-slate-400">Resolved</p>
        </div>
      </div>

      {tickets.length === 0 ? (
        <EmptyState title="No tickets yet" hint="Something needs fixing or you have a question? Raise a ticket and we'll take care of it." />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {tickets.map((t) => (
            <button key={t.id} onClick={() => openDetail(t.id)} className="card-premium p-5 text-left hover:border-blue-500/40 transition w-full">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-xs text-slate-500 font-mono">#{t.ticketNumber}</p>
                  <h3 className="font-bold text-white">{t.title}</h3>
                </div>
                <Badge tone={PRIORITY_TONE[t.priority] || 'slate'}>{t.priority}</Badge>
              </div>
              {t.description && <p className="text-sm text-slate-300 line-clamp-2 mb-3">{t.description}</p>}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  {t.category} · {t._count?.comments || 0} replies · {fmtDate(t.updatedAt)}
                </span>
                <Badge tone={STATUS_TONE[t.status] || 'slate'}>{t.status.replace('_', ' ')}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title="Raise a Ticket" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <Field label="Subject">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} placeholder="e.g. Printer on floor 2 is jammed" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
            </div>
            <Field label="Space (optional)">
              <select className="input" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                <option value="">— None —</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.code}{u.name ? ` — ${u.name}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Details">
              <textarea className="input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue in detail…" />
            </Field>
            {form.priority === 'urgent' && <p className="text-xs text-red-300 mb-3">Urgent tickets alert the ops team immediately.</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Raise Ticket'}</button>
          </form>
        </Modal>
      )}

      {detailId && (
        <Modal title={detail ? `Ticket #${detail.ticketNumber}` : 'Ticket'} onClose={() => { setDetailId(null); setDetail(null); }}>
          {detailLoading && <Spinner />}
          {detail?.error && <ErrorBanner message={detail.error} onRetry={() => openDetail(detailId)} />}
          {detail && !detail.error && (
            <div>
              <h3 className="font-bold text-white text-lg mb-1">{detail.title}</h3>
              <div className="flex flex-wrap gap-2 mb-3 text-xs">
                <Badge tone={STATUS_TONE[detail.status] || 'slate'}>{detail.status.replace('_', ' ')}</Badge>
                <Badge tone={PRIORITY_TONE[detail.priority] || 'slate'}>{detail.priority}</Badge>
                <span className="text-slate-500 self-center">{detail.category}{detail.unit?.code ? ` · ${detail.unit.code}` : ''}{detail.assignedTo?.name ? ` · Assigned to ${detail.assignedTo.name}` : ''}</span>
              </div>
              {detail.description && <p className="text-sm text-slate-300 whitespace-pre-wrap mb-4">{detail.description}</p>}

              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Conversation</p>
              <div className="space-y-3 max-h-72 overflow-y-auto mb-4 pr-1">
                {(detail.comments || []).map((c) => {
                  const r = parseRating(c.body);
                  if (r) {
                    return (
                      <div key={c.id} className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                        <Stars value={r} size="text-lg" />
                        <span className="text-xs text-amber-200">{c.author?.name || 'Member'} rated this ticket</span>
                      </div>
                    );
                  }
                  const mine = user && (c.author?.id === user.id);
                  return (
                    <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 ${mine ? 'bg-blue-600/30 border border-blue-500/30' : 'bg-slate-800/60 border border-slate-700/50'}`}>
                        <p className="text-xs text-slate-400 mb-0.5">{c.author?.name || 'Team'} · {fmtDate(c.createdAt)}</p>
                        <p className="text-sm text-slate-100 whitespace-pre-wrap">{c.body}</p>
                      </div>
                    </div>
                  );
                })}
                {(!detail.comments || detail.comments.length === 0) && (
                  <p className="text-sm text-slate-500">No replies yet — our team will respond soon.</p>
                )}
              </div>

              {!['resolved', 'closed'].includes(detail.status) ? (
                <form onSubmit={sendReply}>
                  <Field label="Add a reply">
                    <textarea className="input" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your message…" required />
                  </Field>
                  {detail.replyError && <p className="text-xs text-red-300 mb-2">{detail.replyError}</p>}
                  <button type="submit" className="btn-primary w-full" disabled={replyBusy || !reply.trim()}>
                    {replyBusy ? 'Sending…' : 'Send Reply'}
                  </button>
                </form>
              ) : (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                  {(detail.comments || []).some((c) => parseRating(c.body)) ? (
                    <p className="text-sm text-emerald-200">This ticket is resolved. Thanks for your feedback!</p>
                  ) : (
                    <div>
                      <p className="text-sm text-emerald-200 mb-2">This ticket is resolved. How was the support?</p>
                      <Stars value={rating} onPick={setRating} />
                      <button onClick={submitRating} disabled={!rating || ratingBusy} className="btn-primary w-full mt-3 disabled:opacity-50">
                        {ratingBusy ? 'Submitting…' : 'Submit Rating'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
