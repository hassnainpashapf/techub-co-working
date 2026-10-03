'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const STATUS_TONE = { paid: 'green', pending: 'amber', partial: 'amber', overdue: 'red', unpaid: 'red' };

function daysOverdue(dueDate) {
  if (!dueDate) return 0;
  const d = new Date(dueDate);
  const diff = Date.now() - d.getTime();
  return diff > 0 ? Math.floor(diff / 86400000) : 0;
}

function InvoiceDetail({ invoice, onClose, onChanged, canRecordPayment = true }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', note: '' });
  const [paying, setPaying] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get(`/billing/invoices/${invoice.id}`);
      const inv = d.invoice || d;
      setDetail(inv);
      const bal = Number(inv.balance ?? inv.amount - (inv.paidAmount || 0));
      setPayForm((f) => ({ ...f, amount: f.amount || String(Math.max(bal, 0)) }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  async function recordPayment(e) {
    e.preventDefault();
    setPaying(true);
    setError('');
    try {
      await api.post(`/billing/invoices/${invoice.id}/payments`, {
        amount: Number(payForm.amount),
        method: payForm.method,
        note: payForm.note,
      });
      setPayForm({ amount: '', method: 'cash', note: '' });
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  }

  const inv = detail || invoice;
  const payments = inv.payments || [];

  return (
    <Modal title={`Invoice ${inv.number || inv.id?.slice(0, 8)}`} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : (
        <div>
          {error && <ErrorBanner message={error} />}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm mb-4">
            <div><p className="text-xs text-slate-400">Member</p><p className="font-medium">{inv.memberName || inv.member?.name || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Total</p><p className="font-medium">{money(inv.amount)}</p></div>
            <div><p className="text-xs text-slate-400">Balance</p><p className="font-medium">{money(inv.balance ?? inv.amount)}</p></div>
            <div><p className="text-xs text-slate-400">Due date</p><p className="font-medium">{inv.dueDate ? String(inv.dueDate).slice(0, 10) : '—'}</p></div>
            <div><p className="text-xs text-slate-400">Status</p><Badge tone={STATUS_TONE[inv.status] || 'slate'}>{inv.status || '—'}</Badge></div>
          </div>

          <h3 className="font-semibold text-white mb-2">Payments ({payments.length})</h3>
          <DataTable
            columns={[
              { key: 'date', label: 'Date', render: (r) => (r.date ? String(r.date).slice(0, 10) : '—') },
              { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
              { key: 'method', label: 'Method', render: (r) => <span className="capitalize">{r.method || '—'}</span> },
              { key: 'note', label: 'Note', render: (r) => r.note || '—' },
            ]}
            rows={payments}
            empty={{ title: 'No payments recorded' }}
          />

          {canRecordPayment && String(inv.status).toLowerCase() !== 'paid' && (
            <form onSubmit={recordPayment} className="mt-4 bg-white/5 rounded-xl p-4">
              <h3 className="font-semibold text-white mb-3 text-sm">Record payment</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Amount (Rs)"><input type="number" min="1" step="any" className="input" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required /></Field>
                <Field label="Method">
                  <select className="input" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="card">Card</option>
                    <option value="online">Online</option>
                  </select>
                </Field>
                <Field label="Note"><input className="input" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="Optional" /></Field>
              </div>
              <button type="submit" className="btn-primary btn-sm" disabled={paying}>{paying ? 'Recording…' : 'Record payment'}</button>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function BillingPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'finance_officer', 'member');
  const { user } = useAuth();
  const isMember = user?.role === 'member';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [genMonth, setGenMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState('');

  const refresh = async () => {
    setError('');
    try {
      const d = await api.get('/billing/invoices');
      setInvoices(d.invoices || d || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      const matchStatus = statusFilter === 'all' || inv.status === statusFilter;
      const invMonth = inv.dueDate ? String(inv.dueDate).slice(0, 7) : (inv.month || '');
      const matchMonth = !monthFilter || invMonth === monthFilter;
      return matchStatus && matchMonth;
    });
  }, [invoices, statusFilter, monthFilter]);

  const dues = useMemo(() => {
    return invoices
      .filter((inv) => String(inv.status).toLowerCase() !== 'paid')
      .map((inv) => ({ ...inv, overdue: daysOverdue(inv.dueDate) }))
      .sort((a, b) => b.overdue - a.overdue);
  }, [invoices]);

  const totalDues = dues.reduce((s, d) => s + Number(d.balance ?? d.amount ?? 0), 0);

  async function generateInvoices() {
    setGenerating(true);
    setGenResult('');
    setError('');
    try {
      const d = await api.post('/billing/invoices/generate', { month: genMonth });
      const count = d.count ?? d.created ?? (d.invoices ? d.invoices.length : 0);
      setGenResult(`Generated ${count} invoice(s) for ${genMonth}.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Billing"
        sub={`${invoices.length} invoices`}
        actions={
          !isMember && (
            <div className="flex items-center gap-2">
              <input type="month" className="input !w-auto" value={genMonth} onChange={(e) => setGenMonth(e.target.value)} />
              <button className="btn-primary" onClick={generateInvoices} disabled={generating}>
                {generating ? 'Generating…' : 'Generate monthly invoices'}
              </button>
            </div>
          )
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />
      {genResult && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">{genResult}</div>}

      <div className="flex gap-2 mb-4">
        {['invoices', 'dues'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`chip ${tab === t ? 'bg-violet-600 text-white' : 'bg-[#131322] text-slate-400 border border-white/10 hover:bg-white/5'}`}
          >
            {t === 'invoices' ? 'Invoices' : `Dues (${dues.length})`}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <div className="card">
          <div className="flex flex-wrap gap-3 mb-4">
            <select className="input max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
            <input type="month" className="input max-w-[180px]" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} placeholder="Filter by month" />
            {monthFilter && <button className="btn-ghost btn-sm" onClick={() => setMonthFilter('')}>Clear</button>}
          </div>
          <DataTable
            columns={[
              { key: 'no', label: 'Invoice', render: (r) => <a className="text-violet-400 font-medium cursor-pointer hover:underline" onClick={() => setSelected(r)}>{r.number || r.id?.slice(0, 8) || '—'}</a> },
              { key: 'member', label: 'Member', render: (r) => r.memberName || r.member?.name || '—' },
              { key: 'month', label: 'Month', render: (r) => r.month || (r.dueDate ? String(r.dueDate).slice(0, 7) : '—') },
              { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
              { key: 'balance', label: 'Balance', render: (r) => money(r.balance ?? r.amount) },
              { key: 'due', label: 'Due date', render: (r) => (r.dueDate ? String(r.dueDate).slice(0, 10) : '—') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
              { key: 'open', label: '', render: (r) => <button className="btn-secondary btn-sm" onClick={() => setSelected(r)}>Open</button> },
            ]}
            rows={filtered}
            empty={{ title: 'No invoices', hint: 'Generate monthly invoices to get started.' }}
          />
        </div>
      )}

      {tab === 'dues' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Outstanding dues</h2>
            <p className="text-sm text-slate-400">Total: <span className="font-bold text-red-600">{money(totalDues)}</span></p>
          </div>
          <DataTable
            columns={[
              { key: 'no', label: 'Invoice', render: (r) => <a className="text-violet-400 font-medium cursor-pointer hover:underline" onClick={() => setSelected(r)}>{r.number || r.id?.slice(0, 8) || '—'}</a> },
              { key: 'member', label: 'Member', render: (r) => r.memberName || r.member?.name || '—' },
              { key: 'balance', label: 'Balance', render: (r) => <span className="font-semibold">{money(r.balance ?? r.amount)}</span> },
              { key: 'due', label: 'Due date', render: (r) => (r.dueDate ? String(r.dueDate).slice(0, 10) : '—') },
              {
                key: 'overdue',
                label: 'Days overdue',
                render: (r) => (
                  <Badge tone={r.overdue > 30 ? 'red' : r.overdue > 0 ? 'amber' : 'green'}>
                    {r.overdue > 0 ? `${r.overdue} days` : 'Not yet due'}
                  </Badge>
                ),
              },
              { key: 'open', label: '', render: (r) => <button className="btn-secondary btn-sm" onClick={() => setSelected(r)}>Open</button> },
            ]}
            rows={dues}
            empty={{ title: 'No dues', hint: 'All invoices are fully paid.' }}
          />
        </div>
      )}

      {selected && (
        <InvoiceDetail invoice={selected} onClose={() => setSelected(null)} onChanged={refresh} canRecordPayment={!isMember} />
      )}
    </div>
  );
}
