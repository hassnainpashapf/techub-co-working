'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useRequireRoles } from '../../../components/Protected';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../components/ui';

const CATS = ['facility', 'service', 'staff', 'cleanliness', 'other'];
const STATUSES = ['new', 'reviewed', 'resolved'];
const STATUS_COLOR = { new: 'amber', reviewed: 'blue', resolved: 'green' };

export default function AdminFeedbackPage() {
  useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ avgRating: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusF, setStatusF] = useState('');
  const [catF, setCatF] = useState('');
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

  const resolve = async (id) => {
    try {
      await api.patch(`/feedback/${id}`, { status: 'resolved' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <PageHeader title="Member Feedback" subtitle="Members ki raye aur ratings" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total feedback" value={summary.total} />
        <StatCard label="Avg rating" value={summary.avgRating != null ? `⭐ ${summary.avgRating}` : '—'} />
        <StatCard label="New" value={items.filter((i) => i.status === 'new').length} />
        <StatCard label="Resolved" value={items.filter((i) => i.status === 'resolved').length} />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-3 mb-4">
        <select className="input max-w-48" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-48" value={catF} onChange={(e) => setCatF(e.target.value)}>
          <option value="">All categories</option>
          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? <Spinner /> : items.length === 0 ? (
        <EmptyState title="Koi feedback nahi" />
      ) : (
        <div className="card-premium overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-white/10">
                <th className="p-3">Member</th>
                <th className="p-3">Category</th>
                <th className="p-3">Rating</th>
                <th className="p-3">Message</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3 text-white">{f.member?.name || '—'}</td>
                  <td className="p-3 text-slate-300">{f.category}</td>
                  <td className="p-3">{'⭐'.repeat(f.rating)}</td>
                  <td className="p-3 text-slate-300 max-w-xs truncate" title={f.message}>{f.message}</td>
                  <td className="p-3"><Badge color={STATUS_COLOR[f.status] || 'slate'}>{f.status}</Badge></td>
                  <td className="p-3 flex gap-2">
                    <button className="btn-secondary text-xs" onClick={() => openReply(f)}>Reply</button>
                    {f.status !== 'resolved' && (
                      <button className="btn-secondary text-xs" onClick={() => resolve(f.id)}>Resolve</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {replyFor && (
        <Modal title={`Reply — ${replyFor.member?.name || 'member'}`} onClose={() => setReplyFor(null)}>
          <p className="text-sm text-slate-300 mb-4 p-3 rounded-lg bg-white/5">"{replyFor.message}"</p>
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
