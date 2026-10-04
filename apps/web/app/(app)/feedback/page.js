'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useRequireRoles } from '../../../components/Protected';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../components/ui';

const CATS = ['suggestion', 'complaint', 'praise', 'facility', 'service', 'staff', 'cleanliness', 'other'];
const STATUSES = ['new', 'reviewed', 'planned', 'done', 'rejected', 'resolved'];
const STATUS_COLOR = { new: 'amber', reviewed: 'blue', planned: 'violet', done: 'green', rejected: 'red', resolved: 'green' };
const COLUMNS = [
  { v: 'new', l: '🆕 New' },
  { v: 'reviewed', l: '👀 Reviewed' },
  { v: 'planned', l: '📋 Planned' },
  { v: 'done', l: '✅ Done' },
  { v: 'rejected', l: '🚫 Rejected' },
];

export default function AdminFeedbackPage() {
  useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ avgRating: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusF, setStatusF] = useState('');
  const [catF, setCatF] = useState('');
  const [view, setView] = useState('kanban'); // kanban | list
  const [replyFor, setReplyFor] = useState(null);
  const [reply, setReply] = useState('');
  const [newStatus, setNewStatus] = useState('reviewed');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (statusF) q.set('status', statusF);
    if (catF) q.set('category', catF);
    api.get(`/feedback?${q.toString()}`)
      .then((d) => { setItems(d.items || []); setSummary(d.summary || { avgRating: null, total: 0 }); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [statusF, catF]);

  const byStatus = useMemo(() => {
    const m = {};
    for (const c of COLUMNS) m[c.v] = [];
    for (const f of items) {
      const k = f.status === 'resolved' ? 'done' : f.status;
      (m[k] || m.new).push(f);
    }
    return m;
  }, [items]);

  const openReply = (f) => {
    setReplyFor(f);
    setReply(f.adminReply || '');
    setNewStatus(f.status === 'new' ? 'reviewed' : f.status);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/feedback/${replyFor.id}`, { status: newStatus, adminReply: reply.trim() || null });
      setReplyFor(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id, status) => {
    try {
      await api.patch(`/feedback/${id}`, { status });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const who = (f) => (f.isAnonymous ? '🕵️ Anonymous' : f.member?.name || '—');

  return (
    <div>
      <PageHeader title="Feedback & Suggestions" subtitle="Members ki raye, shikayat aur tajaveez" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard label="Total feedback" value={summary.total} />
        <StatCard label="New" value={items.filter((i) => i.status === 'new').length} />
        <StatCard label="Avg rating" value={summary.avgRating != null ? `⭐ ${summary.avgRating}` : '—'} />
        <StatCard label="Done" value={items.filter((i) => ['done', 'resolved'].includes(i.status)).length} />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select className="input max-w-48" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-48" value={catF} onChange={(e) => setCatF(e.target.value)}>
          <option value="">All categories</option>
          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex gap-1 ml-auto">
          {[{ v: 'kanban', l: '📊 Board' }, { v: 'list', l: '📋 List' }].map((t) => (
            <button
              key={t.v}
              onClick={() => setView(t.v)}
              className={`text-sm rounded-lg px-3 py-1.5 border ${view === t.v ? 'bg-[#0f766e]/20 border-[#0f766e]/40 text-teal-700' : 'bg-gray-100 border-gray-200 text-gray-500'}`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {loading ? <Spinner /> : items.length === 0 ? (
        <EmptyState title="Koi feedback nahi" />
      ) : view === 'kanban' ? (
        <div className="grid md:grid-cols-3 xl:grid-cols-5 gap-4">
          {COLUMNS.map((col) => (
            <div key={col.v} className="rounded-xl bg-gray-50 border border-gray-200 p-3 min-h-40">
              <p className="text-sm font-bold text-gray-900 mb-3">{col.l} <span className="text-slate-500">({byStatus[col.v].length})</span></p>
              <div className="space-y-2">
                {byStatus[col.v].map((f) => (
                  <div key={f.id} className="rounded-lg bg-gray-100 border border-gray-200 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-500">{f.category}</span>
                      <span className="text-xs text-gray-500">👍 {f.upvotes || 0}</span>
                    </div>
                    {f.title && <p className="text-sm font-semibold text-gray-900">{f.title}</p>}
                    <p className="text-xs text-gray-600 line-clamp-3">{f.body}</p>
                    <p className="text-xs text-slate-500 mt-1">{who(f)}</p>
                    <div className="flex gap-1 mt-2">
                      <button className="text-xs text-teal-700 underline" onClick={() => openReply(f)}>Reply</button>
                      {col.v !== 'done' && (
                        <button className="text-xs text-emerald-700 underline" onClick={() => setStatus(f.id, 'done')}>Done</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card-premium overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="p-3">Member</th>
                <th className="p-3">Category</th>
                <th className="p-3">Title / Message</th>
                <th className="p-3">👍</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id} className="border-b border-gray-200 hover:bg-gray-100">
                  <td className="p-3 text-gray-900">{who(f)}</td>
                  <td className="p-3 text-gray-600">{f.category}</td>
                  <td className="p-3 text-gray-600 max-w-xs truncate" title={f.body}>
                    {f.title ? <span className="font-semibold text-gray-900">{f.title} — </span> : ''}{f.body}
                  </td>
                  <td className="p-3 text-gray-600">{f.upvotes || 0}</td>
                  <td className="p-3"><Badge color={STATUS_COLOR[f.status] || 'slate'}>{f.status}</Badge></td>
                  <td className="p-3 flex gap-2">
                    <button className="btn-secondary text-xs" onClick={() => openReply(f)}>Reply</button>
                    {!['done', 'resolved'].includes(f.status) && (
                      <button className="btn-secondary text-xs" onClick={() => setStatus(f.id, 'done')}>Done</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {replyFor && (
        <Modal title={`Reply — ${who(replyFor)}`} onClose={() => setReplyFor(null)}>
          {replyFor.title && <p className="text-sm font-semibold text-gray-900 mb-2">{replyFor.title}</p>}
          <p className="text-sm text-gray-600 mb-4 p-3 rounded-lg bg-gray-100">"{replyFor.body}"</p>
          <Field label="Status">
            <select className="input" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Admin reply">
            <textarea className="input" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Jawab likhein…" />
          </Field>
          <button className="btn-primary w-full" onClick={save} disabled={saving}>
            {saving ? 'Save ho raha…' : 'Save'}
          </button>
        </Modal>
      )}
    </div>
  );
}
