'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Spinner, ErrorBanner, Badge, Modal, Field } from '../../../../components/ui';

export default function MemberTickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'general', priority: 'medium' });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/tickets')
      .then((d) => setTickets(d.tickets || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/tickets', form);
      setShowForm(false);
      setForm({ title: '', description: '', category: 'general', priority: 'medium' });
      load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const openDetail = async (t) => {
    try {
      const d = await api.get(`/tickets/${t.id}`);
      setDetail(d.ticket);
    } catch (e) { setError(e.message); }
  };

  const sendComment = async () => {
    if (!comment.trim() || !detail) return;
    try {
      await api.post(`/tickets/${detail.id}/comments`, { body: comment.trim() });
      setComment('');
      openDetail(detail);
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-gray-900">My Tickets</h1>
        <button className="btn-primary text-sm" onClick={() => setShowForm(true)}>+ Raise Ticket</button>
      </div>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <button key={t.id} onClick={() => openDetail(t)} className="w-full text-left card-premium p-4 hover:border-teal-500/40 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs text-gray-500">#{t.ticketNumber}</span>
                <Badge tone={t.status === 'open' ? 'blue' : t.status === 'resolved' ? 'green' : 'amber'}>{t.status.replace('_', ' ')}</Badge>
              </div>
              <div className="font-medium text-gray-900">{t.title}</div>
              <div className="text-xs text-gray-500 mt-1 capitalize">{t.category} · {t.priority} priority</div>
            </button>
          ))}
          {tickets.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No tickets yet.</p>}
        </div>
      )}
      {showForm && (
        <Modal title="Raise a Ticket" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
            <Field label="Description"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {['maintenance', 'billing', 'it', 'housekeeping', 'security', 'general'].map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                </select>
              </Field>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Submitting…' : 'Submit Ticket'}</button>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal title={`Ticket #${detail.ticketNumber}`} onClose={() => setDetail(null)}>
          <div className="space-y-3">
            <div className="font-medium text-gray-900">{detail.title}</div>
            {detail.description && <p className="text-sm text-gray-600">{detail.description}</p>}
            <Badge tone={detail.status === 'open' ? 'blue' : 'amber'}>{detail.status.replace('_', ' ')}</Badge>
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Comments</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {(detail.comments || []).map((c) => (
                  <div key={c.id} className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="text-xs text-gray-500 mb-0.5">{c.author?.name} · {new Date(c.createdAt).toLocaleString()}</div>
                    <div className="text-sm text-gray-800">{c.body}</div>
                  </div>
                ))}
                {(detail.comments || []).length === 0 && <p className="text-xs text-slate-500">No comments yet.</p>}
              </div>
              <div className="flex gap-2 mt-2">
                <input className="input flex-1" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" onKeyDown={(e) => e.key === 'Enter' && sendComment()} />
                <button className="btn-primary text-sm" onClick={sendComment}>Send</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
