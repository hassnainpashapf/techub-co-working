'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
  DataTable,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'receptionist', 'operations_manager'];

const CATEGORIES = [
  { v: 'maintenance', l: 'Maintenance' },
  { v: 'billing', l: 'Billing' },
  { v: 'it', l: 'IT / Internet' },
  { v: 'housekeeping', l: 'Housekeeping' },
  { v: 'security', l: 'Security' },
  { v: 'general', l: 'General' },
];
const PRIORITIES = [
  { v: 'low', l: 'Low', tone: 'slate' },
  { v: 'medium', l: 'Medium', tone: 'blue' },
  { v: 'high', l: 'High', tone: 'amber' },
  { v: 'urgent', l: 'Urgent', tone: 'red' },
];
const STATUSES = [
  { v: 'open', l: 'Open', tone: 'blue' },
  { v: 'in_progress', l: 'In Progress', tone: 'amber' },
  { v: 'on_hold', l: 'On Hold', tone: 'slate' },
  { v: 'resolved', l: 'Resolved', tone: 'green' },
  { v: 'closed', l: 'Closed', tone: 'slate' },
];

const toneOf = (list, v) => (list.find((x) => x.v === v)?.tone || 'slate');
const labelOf = (list, v) => (list.find((x) => x.v === v)?.l || v);

function TicketForm({ initial, onSave, saving }) {
  const [form, setForm] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    category: initial?.category || 'general',
    priority: initial?.priority || 'medium',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="e.g. AC not working in meeting room" /></Field>
      <Field label="Description"><textarea className="input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue in detail…" /></Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Category">
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </Field>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update ticket' : 'Raise ticket'}</button>
    </form>
  );
}

function TicketDetail({ ticket, onClose, onUpdate, canWrite }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get(`/tickets/${ticket.id}`)
      .then((d) => setDetail(d.ticket))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [ticket.id]);

  const setStatus = async (status) => {
    try {
      await api.patch(`/tickets/${ticket.id}`, { status });
      load(); onUpdate();
    } catch (e) { setError(e.message); }
  };

  const sendComment = async () => {
    if (!comment.trim()) return;
    setSending(true);
    try {
      await api.post(`/tickets/${ticket.id}/comments`, { body: comment.trim() });
      setComment('');
      load();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  };

  return (
    <Modal title={`Ticket #${ticket.ticketNumber} — ${ticket.title}`} onClose={onClose} wide>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading || !detail ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone={toneOf(STATUSES, detail.status)}>{labelOf(STATUSES, detail.status)}</Badge>
            <Badge tone={toneOf(PRIORITIES, detail.priority)}>{labelOf(PRIORITIES, detail.priority)} priority</Badge>
            <Badge tone="slate">{labelOf(CATEGORIES, detail.category)}</Badge>
          </div>
          {detail.description && <p className="text-sm text-gray-800 whitespace-pre-wrap">{detail.description}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><div className="text-xs text-gray-500">Reported by</div><div className="text-gray-900">{detail.reportedBy?.name || detail.member?.name || '—'}</div></div>
            <div><div className="text-xs text-gray-500">Assigned to</div><div className="text-gray-900">{detail.assignedTo?.name || 'Unassigned'}</div></div>
            <div><div className="text-xs text-gray-500">Unit</div><div className="text-gray-900">{detail.unit?.code || '—'}</div></div>
            <div><div className="text-xs text-gray-500">Created</div><div className="text-gray-900">{new Date(detail.createdAt).toLocaleDateString()}</div></div>
          </div>

          {canWrite && (
            <div className="flex flex-wrap gap-2 pt-1">
              {STATUSES.filter((s) => s.v !== detail.status).map((s) => (
                <button key={s.v} className="btn-secondary text-xs px-3 py-1.5" onClick={() => setStatus(s.v)}>
                  → {s.l}
                </button>
              ))}
            </div>
          )}

          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Comments ({detail.comments?.length || 0})</h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(detail.comments || []).map((c) => (
                <div key={c.id} className={`p-3 rounded-lg border ${c.isInternal ? 'border-amber-200 bg-amber-500/5' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-800">{c.author?.name || 'System'}</span>
                    <span className="text-[11px] text-slate-500">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.body}</p>
                  {c.isInternal && <div className="mt-1"><Badge tone="amber">Internal note</Badge></div>}
                </div>
              ))}
              {(!detail.comments || detail.comments.length === 0) && <p className="text-sm text-slate-500">No comments yet.</p>}
            </div>
            <div className="flex gap-2 mt-3">
              <input className="input flex-1" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" onKeyDown={(e) => e.key === 'Enter' && sendComment()} />
              <button className="btn-primary" onClick={sendComment} disabled={sending || !comment.trim()}>{sending ? '…' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function TicketsPage() {
  const { allowed, user } = useRequireRoles(['ceo', 'admin', 'manager', 'receptionist', 'operations_manager', 'finance_manager', 'office_boy', 'member']);
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({ open: 0, inProgress: 0, urgent: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  const canWrite = user && WRITE_ROLES.includes(user.role);

  const load = () => {
    setLoading(true);
    const q = statusFilter ? `?status=${statusFilter}` : '';
    Promise.all([api.get(`/tickets${q}`), api.get('/tickets/stats')])
      .then(([t, s]) => { setTickets(t.tickets || []); setStats(s.stats || {}); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed, statusFilter]);

  if (!allowed) return <AccessDenied />;

  const handleSave = async (data) => {
    setSaving(true);
    try {
      await api.post('/tickets', data);
      setShowForm(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const columns = [
    { key: 'ticketNumber', label: '#', render: (t) => <span className="font-mono text-gray-600">#{t.ticketNumber}</span> },
    { key: 'title', label: 'Title', render: (t) => <button className="text-left text-gray-900 hover:text-teal-700 font-medium" onClick={() => setSelected(t)}>{t.title}</button> },
    { key: 'category', label: 'Category', render: (t) => <span className="text-gray-600 text-sm">{labelOf(CATEGORIES, t.category)}</span> },
    { key: 'priority', label: 'Priority', render: (t) => <Badge tone={toneOf(PRIORITIES, t.priority)}>{labelOf(PRIORITIES, t.priority)}</Badge> },
    { key: 'status', label: 'Status', render: (t) => <Badge tone={toneOf(STATUSES, t.status)}>{labelOf(STATUSES, t.status)}</Badge> },
    { key: 'assignedTo', label: 'Assignee', render: (t) => <span className="text-gray-600 text-sm">{t.assignedTo?.name || '—'}</span> },
    { key: 'createdAt', label: 'Created', render: (t) => <span className="text-gray-500 text-sm">{new Date(t.createdAt).toLocaleDateString()}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Tickets & Complaints"
        subtitle="Track and resolve issues"
        action={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Raise Ticket</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="grid grid-cols-3 gap-3 mb-3">
        {[
          { l: 'Open', v: stats.open, tone: 'blue' },
          { l: 'In Progress', v: stats.inProgress, tone: 'amber' },
          { l: 'Urgent', v: stats.urgent, tone: 'red' },
        ].map((s) => (
          <div key={s.l} className="card-premium p-4">
            <div className="text-2xl font-extrabold text-gray-900">{s.v}</div>
            <div className="text-xs text-gray-500">{s.l} tickets</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-3">
        {[{ v: '', l: 'All' }, ...STATUSES].map((s) => (
          <button
            key={s.v}
            onClick={() => setStatusFilter(s.v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === s.v ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
          >
            {s.l}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <DataTable columns={columns} rows={tickets} emptyText="No tickets found." />
      )}

      {showForm && (
        <Modal title="Raise a Ticket" onClose={() => setShowForm(false)}>
          <TicketForm onSave={handleSave} saving={saving} />
        </Modal>
      )}
      {selected && (
        <TicketDetail ticket={selected} onClose={() => setSelected(null)} onUpdate={load} canWrite={canWrite} />
      )}
    </div>
  );
}
