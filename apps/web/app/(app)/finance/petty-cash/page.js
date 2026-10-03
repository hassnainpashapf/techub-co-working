'use client';

import { useEffect, useState } from 'react';
import {
  PageHeader, StatCard, DataTable, Modal, Field, Badge, Spinner, ErrorBanner, EmptyState,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';
import { api } from '../../../../lib/api';

const CATEGORIES = ['Office supplies', 'Refreshments', 'Maintenance', 'Transport', 'Utilities', 'Other'];

export default function PettyCashPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'finance_officer', 'manager', 'super_admin');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ totalIn: 0, totalOut: 0, balance: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modal, setModal] = useState(null); // 'in' | 'out' | null
  const [form, setForm] = useState({ amount: '', reason: '', category: 'Other' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = typeFilter ? `?type=${typeFilter}` : '';
      const data = await api.get(`/petty-cash${q}`);
      setItems(data.items || []);
      setSummary(data.summary || { totalIn: 0, totalOut: 0, balance: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed, typeFilter]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/petty-cash', {
        type: modal,
        amount: Number(form.amount),
        reason: form.reason,
        category: form.category || null,
      });
      setModal(null);
      setForm({ amount: '', reason: '', category: 'Other' });
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this transaction?')) return;
    try {
      await api.delete(`/petty-cash/${id}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;

  const bal = Number(summary.balance || 0);

  return (
    <div>
      <PageHeader
        title="Petty Cash"
        sub="Daily cash in / cash out register"
        actions={
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => setModal('in')}>+ Cash In</button>
            <button className="btn-danger" onClick={() => setModal('out')}>− Cash Out</button>
          </div>
        }
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Current Balance" value={`Rs ${bal.toLocaleString()}`} accent={bal >= 0 ? 'green' : 'red'} sub={bal >= 0 ? 'Healthy' : 'Negative!'} />
        <StatCard label="Total In" value={`Rs ${Number(summary.totalIn || 0).toLocaleString()}`} accent="blue" />
        <StatCard label="Total Out" value={`Rs ${Number(summary.totalOut || 0).toLocaleString()}`} accent="amber" />
      </div>

      <div className="flex gap-2 mb-4">
        {['', 'in', 'out'].map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium ${typeFilter === t ? 'bg-blue-600 text-white' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'}`}
          >
            {t === '' ? 'All' : t === 'in' ? 'Cash In' : 'Cash Out'}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="No transactions yet" hint="Record your first cash in or cash out above." />
      ) : (
        <DataTable
          columns={[
            { key: 'createdAt', label: 'Date' },
            { key: 'type', label: 'Type' },
            { key: 'reason', label: 'Reason' },
            { key: 'category', label: 'Category' },
            { key: 'amount', label: 'Amount', align: 'right' },
            { key: 'performer', label: 'By' },
            { key: 'actions', label: '' },
          ]}
          rows={items.map((it) => ({
            createdAt: new Date(it.createdAt).toLocaleString(),
            type: <Badge tone={it.type === 'in' ? 'green' : 'red'}>{it.type === 'in' ? '+ In' : '− Out'}</Badge>,
            reason: it.reason,
            category: it.category || '—',
            amount: <span className={it.type === 'in' ? 'text-emerald-300' : 'text-red-300'}>Rs {Number(it.amount).toLocaleString()}</span>,
            performer: it.performer?.name || '—',
            actions: <button className="text-xs text-red-400 hover:text-red-300" onClick={() => remove(it.id)}>Delete</button>,
          }))}
        />
      )}

      {modal && (
        <Modal title={modal === 'in' ? 'Record Cash In' : 'Record Cash Out'} onClose={() => setModal(null)}>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Amount (Rs)">
              <input type="number" min="1" step="any" className="input" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </Field>
            <Field label="Reason">
              <input className="input" value={form.reason} placeholder="e.g. Stationery purchase"
                onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
            </Field>
            <Field label="Category">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <button type="submit" className={modal === 'in' ? 'btn-primary w-full' : 'btn-danger w-full'} disabled={saving}>
              {saving ? 'Saving…' : modal === 'in' ? 'Record Cash In' : 'Record Cash Out'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
