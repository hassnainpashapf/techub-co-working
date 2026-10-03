'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
  EmptyState,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const STATUS_TONE = { active: 'green', paused: 'amber', cancelled: 'red' };
const FREQS = [
  { v: 'monthly', label: 'Monthly' },
  { v: 'quarterly', label: 'Quarterly' },
  { v: 'yearly', label: 'Yearly' },
];
const BILLING_ROLES = ['ceo', 'admin', 'super_admin', 'finance_officer'];

function RecurringInvoiceForm({ members, onSave, saving, error }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    memberId: '',
    title: '',
    amount: '',
    frequency: 'monthly',
    dayOfMonth: '1',
    startDate: today,
    endDate: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.memberId) return;
    onSave({
      memberId: form.memberId,
      title: form.title.trim(),
      amount: Number(form.amount),
      frequency: form.frequency,
      dayOfMonth: Number(form.dayOfMonth),
      startDate: form.startDate,
      endDate: form.endDate || null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorBanner message={error} />}
      <Field label="Member">
        <select className="input" value={form.memberId} onChange={set('memberId')} required>
          <option value="">Select member…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}{m.email ? ` — ${m.email}` : ''}</option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input className="input" value={form.title} onChange={set('title')} placeholder="e.g. Monthly membership" required maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount (Rs)">
          <input type="number" min="1" step="0.01" className="input" value={form.amount} onChange={set('amount')} required />
        </Field>
        <Field label="Frequency">
          <select className="input" value={form.frequency} onChange={set('frequency')}>
            {FREQS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Day of month">
          <input type="number" min="1" max="28" className="input" value={form.dayOfMonth} onChange={set('dayOfMonth')} required />
        </Field>
        <Field label="Start date">
          <input type="date" className="input" value={form.startDate} onChange={set('startDate')} required />
        </Field>
        <Field label="End date (optional)">
          <input type="date" className="input" value={form.endDate} onChange={set('endDate')} />
        </Field>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? 'Saving…' : 'Create recurring invoice'}
      </button>
    </form>
  );
}

export default function RecurringInvoicesPage() {
  const allowed = useRequireRoles(BILLING_ROLES);
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [ri, mem] = await Promise.all([
        api.get('/recurring-invoices'),
        api.get('/members?limit=500'),
      ]);
      setItems(ri.recurringInvoices || []);
      setMembers(mem.members || mem.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const filtered = statusFilter === 'all' ? items : items.filter((i) => i.status === statusFilter);

  const create = async (payload) => {
    setSaving(true);
    setFormError('');
    try {
      await api.post('/recurring-invoices', payload);
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id, status) => {
    try {
      await api.patch(`/recurring-invoices/${id}`, { status });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const cancel = async (id) => {
    if (!window.confirm('Cancel this recurring invoice? No more invoices will be generated.')) return;
    try {
      await api.delete(`/recurring-invoices/${id}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
  const fmtMoney = (n) => `Rs ${Number(n).toLocaleString()}`;

  return (
    <div>
      <PageHeader
        title="Recurring Invoices"
        sub="Auto-generate invoices on a schedule — monthly, quarterly or yearly."
        action={<button className="btn-primary" onClick={() => setModalOpen(true)}>+ New recurring invoice</button>}
      />
      {error && <ErrorBanner message={error} />}
      <div className="flex gap-2 mb-4">
        {['all', 'active', 'paused', 'cancelled'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
          >
            {s[0].toUpperCase() + s.slice(1)}
            {s !== 'all' && ` (${items.filter((i) => i.status === s).length})`}
          </button>
        ))}
      </div>
      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title="No recurring invoices" hint="Create one to auto-bill a member on schedule." />
      ) : (
        <DataTable
          columns={['Member', 'Title', 'Amount', 'Frequency', 'Day', 'Next run', 'Last generated', 'Status', 'Actions']}
          rows={filtered.map((i) => [
            i.member?.name || '—',
            i.title,
            fmtMoney(i.amount),
            FREQS.find((f) => f.v === i.frequency)?.label || i.frequency,
            i.dayOfMonth,
            fmtDate(i.nextRunAt),
            fmtDate(i.lastGeneratedAt),
            <Badge key="s" tone={STATUS_TONE[i.status] || 'slate'}>{i.status}</Badge>,
            <div key="a" className="flex gap-1">
              {i.status === 'active' && (
                <button className="btn-sm btn-ghost" onClick={() => setStatus(i.id, 'paused')}>Pause</button>
              )}
              {i.status === 'paused' && (
                <button className="btn-sm btn-ghost" onClick={() => setStatus(i.id, 'active')}>Resume</button>
              )}
              {i.status !== 'cancelled' && (
                <button className="btn-sm btn-danger" onClick={() => cancel(i.id)}>Cancel</button>
              )}
            </div>,
          ])}
        />
      )}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New recurring invoice">
        <RecurringInvoiceForm members={members} onSave={create} saving={saving} error={formError} />
      </Modal>
    </div>
  );
}
