'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  StatCard,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

const CATEGORIES = [
  'rent_building',
  'utilities',
  'internet',
  'cleaning',
  'kitchen',
  'maintenance',
  'marketing',
  'salaries',
  'petty_cash',
  'other',
];

function ExpenseForm({ initial, onSave, saving }) {
  const [form, setForm] = useState({
    category: initial?.category || 'utilities',
    amount: initial?.amount ?? '',
    date: initial?.date ? String(initial.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    paidBy: initial?.paidBy || '',
    note: initial?.note || '',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...form, amount: Number(form.amount) || 0 });
      }}
    >
      <Field label="Category">
        <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </Field>
      <Field label="Amount (Rs)"><input type="number" min="0" step="any" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></Field>
      <Field label="Date"><input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></Field>
      <Field label="Paid by"><input className="input" value={form.paidBy} onChange={(e) => setForm({ ...form, paidBy: e.target.value })} placeholder="Who paid" /></Field>
      <Field label="Note"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional note" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save expense'}</button>
    </form>
  );
}

export default function FinancePage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'finance_officer');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [pnl, setPnl] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [catFilter, setCatFilter] = useState('all');
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', data}
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const [p, e] = await Promise.all([
        api.get(`/finance/pnl?month=${month}`),
        api.get(`/finance/expenses?month=${month}`),
      ]);
      setPnl(p.pnl || p || null);
      setExpenses(e.expenses || e || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const filtered = useMemo(
    () => expenses.filter((x) => catFilter === 'all' || x.category === catFilter),
    [expenses, catFilter]
  );

  const income = Number(pnl?.income ?? pnl?.totalIncome ?? 0);
  const totalExpenses = Number(pnl?.expenses ?? pnl?.totalExpenses ?? 0);
  const net = Number(pnl?.net ?? pnl?.profit ?? income - totalExpenses);

  async function handleSave(payload) {
    setSaving(true);
    try {
      if (modal.mode === 'add') await api.post('/finance/expenses', payload);
      else await api.put(`/finance/expenses/${modal.data.id}`, payload);
      setModal(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await api.del(`/finance/expenses/${id}`);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Finance"
        sub="Profit & loss and expense tracking"
        actions={
          <div className="flex items-center gap-2">
            <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button className="btn-primary" onClick={() => setModal({ mode: 'add' })}>+ Add expense</button>
          </div>
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Income" value={money(income)} sub={`collected in ${month}`} accent="green" />
        <StatCard label="Expenses" value={money(totalExpenses)} sub={`${expenses.length} expense(s)`} accent="red" />
        <StatCard label="Net profit" value={money(net)} sub={net >= 0 ? 'in the green' : 'in the red'} accent={net >= 0 ? 'indigo' : 'amber'} />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold text-white">Expenses — {month}</h2>
          <select className="input max-w-[200px]" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <DataTable
          columns={[
            { key: 'date', label: 'Date', render: (r) => (r.date ? String(r.date).slice(0, 10) : '—') },
            { key: 'category', label: 'Category', render: (r) => <Badge tone="blue" className="capitalize">{String(r.category || '').replace(/_/g, ' ')}</Badge> },
            { key: 'amount', label: 'Amount', render: (r) => <span className="font-medium">{money(r.amount)}</span> },
            { key: 'paidBy', label: 'Paid by', render: (r) => r.paidBy || '—' },
            { key: 'note', label: 'Note', render: (r) => r.note || '—' },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) => (
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: 'edit', data: r })}>Edit</button>
                  <button className="btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Delete</button>
                </div>
              ),
            },
          ]}
          rows={filtered}
          empty={{ title: 'No expenses', hint: 'Add your first expense for this month.' }}
        />
      </div>

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add expense' : 'Edit expense'} onClose={() => setModal(null)}>
          <ExpenseForm initial={modal.data} onSave={handleSave} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
