'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const CATEGORIES = [
  { v: 'electrical', l: 'Electrical' }, { v: 'plumbing', l: 'Plumbing' },
  { v: 'hvac', l: 'HVAC' }, { v: 'furniture', l: 'Furniture' },
  { v: 'it', l: 'IT' }, { v: 'cleaning', l: 'Cleaning' }, { v: 'general', l: 'General' },
];
const STATUSES = [
  { v: 'pending', l: 'Pending', tone: 'amber' },
  { v: 'in_progress', l: 'In Progress', tone: 'blue' },
  { v: 'completed', l: 'Completed', tone: 'green' },
  { v: 'cancelled', l: 'Cancelled', tone: 'slate' },
];
const PRIORITIES = [
  { v: 'low', l: 'Low', tone: 'slate' }, { v: 'medium', l: 'Medium', tone: 'blue' },
  { v: 'high', l: 'High', tone: 'amber' }, { v: 'urgent', l: 'Urgent', tone: 'red' },
];
const toneOf = (l, v) => l.find((x) => x.v === v)?.tone || 'slate';
const labelOf = (l, v) => l.find((x) => x.v === v)?.l || v;
const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

function OrderForm({ onSave, saving }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'general', priority: 'medium', cost: '', scheduledAt: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...form, cost: form.cost ? Number(form.cost) : null, scheduledAt: form.scheduledAt || null }); }}>
      <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Fix leaking tap" /></Field>
      <Field label="Description"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
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
        <Field label="Est. cost (Rs)"><input type="number" min="0" className="input" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
        <Field label="Scheduled date"><input type="date" className="input" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></Field>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Creating…' : 'Create Work Order'}</button>
    </form>
  );
}

export default function MaintenancePage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'operations_manager', 'office_boy']);
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({ pending: 0, inProgress: 0, totalCost: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    const q = statusFilter ? `?status=${statusFilter}` : '';
    Promise.all([api.get(`/maintenance${q}`), api.get('/maintenance/stats')])
      .then(([o, s]) => { setOrders(o.orders || []); setStats(s.stats || {}); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed, statusFilter]);

  if (!allowed) return <AccessDenied />;

  const create = async (data) => {
    setSaving(true);
    try {
      await api.post('/maintenance', data);
      setShowForm(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const setStatus = async (id, status) => {
    try {
      await api.patch(`/maintenance/${id}`, { status });
      load();
    } catch (e) { setError(e.message); }
  };

  const columns = [
    { key: 'orderNumber', label: '#', render: (o) => <span className="font-mono text-gray-600">#{o.orderNumber}</span> },
    { key: 'title', label: 'Work Order', render: (o) => <div><div className="font-medium text-gray-900">{o.title}</div><div className="text-xs text-gray-500">{labelOf(CATEGORIES, o.category)}{o.unit?.code ? ` · ${o.unit.code}` : ''}</div></div> },
    { key: 'priority', label: 'Priority', render: (o) => <Badge tone={toneOf(PRIORITIES, o.priority)}>{labelOf(PRIORITIES, o.priority)}</Badge> },
    { key: 'status', label: 'Status', render: (o) => <Badge tone={toneOf(STATUSES, o.status)}>{labelOf(STATUSES, o.status)}</Badge> },
    { key: 'assigned', label: 'Assignee', render: (o) => <span className="text-sm text-gray-600">{o.assignedTo?.name || '—'}</span> },
    { key: 'cost', label: 'Cost', render: (o) => <span className="text-sm text-gray-600">{o.cost ? money(o.cost) : '—'}</span> },
    {
      key: 'action', label: '', render: (o) => (
        <div className="flex gap-1">
          {o.status === 'pending' && <button className="btn-secondary text-xs px-2 py-1" onClick={() => setStatus(o.id, 'in_progress')}>Start</button>}
          {o.status === 'in_progress' && <button className="btn-secondary text-xs px-2 py-1" onClick={() => setStatus(o.id, 'completed')}>Done</button>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Work orders & repairs"
        action={<button className="btn-primary" onClick={() => setShowForm(true)}>+ New Work Order</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="card-premium p-4"><div className="text-2xl font-extrabold text-amber-300">{stats.pending}</div><div className="text-xs text-gray-500">Pending</div></div>
        <div className="card-premium p-4"><div className="text-2xl font-extrabold text-teal-700">{stats.inProgress}</div><div className="text-xs text-gray-500">In Progress</div></div>
        <div className="card-premium p-4"><div className="text-2xl font-extrabold text-gray-900">{money(stats.totalCost)}</div><div className="text-xs text-gray-500">Completed cost</div></div>
      </div>
      <div className="flex gap-2 mb-4">
        {[{ v: '', l: 'All' }, ...STATUSES].map((s) => (
          <button key={s.v} onClick={() => setStatusFilter(s.v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${statusFilter === s.v ? 'border-teal-500/60 bg-teal-600/20 text-violet-200' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
            {s.l}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : <DataTable columns={columns} rows={orders} emptyText="No work orders." />}
      {showForm && (
        <Modal title="New Work Order" onClose={() => setShowForm(false)}>
          <OrderForm onSave={create} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
