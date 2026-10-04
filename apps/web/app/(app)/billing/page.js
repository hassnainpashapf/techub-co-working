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

// Phase 31: Pay Online — gateway select modal → payment link/instructions
function PayOnlineButton({ invoiceId }) {
  const [open, setOpen] = useState(false);
  const [gateways, setGateways] = useState([]);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const openModal = async () => {
    setOpen(true); setResult(null); setError('');
    try {
      const d = await api.get('/gateways');
      const list = (d.gateways || []).filter((g) => g.configured);
      setGateways(list);
      if (list.length) setSelected(list[0].name);
    } catch (e) { setError(e.message); }
  };

  const create = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const d = await api.post('/gateways/create', { invoiceId, gateway: selected });
      setResult(d);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={openModal}>💳 Pay Online</button>
      {open && (
        <Modal title="Pay Online" onClose={() => setOpen(false)}>
          {error && <ErrorBanner message={error} />}
          {!result ? (
            <div>
              <Field label="Payment method">
                <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
                  {gateways.map((g) => <option key={g.name} value={g.name}>{g.displayName}</option>)}
                </select>
              </Field>
              {gateways.length === 0 && <p className="text-sm text-slate-400 mb-3">No payment gateways configured.</p>}
              <button className="btn-primary btn-sm" disabled={busy || !selected} onClick={create}>
                {busy ? 'Creating…' : 'Continue'}
              </button>
            </div>
          ) : (
            <div>
              {result.paymentUrl ? (
                <a href={result.paymentUrl} target="_blank" rel="noreferrer" className="btn-primary btn-sm">Open payment page ↗</a>
              ) : (
                <div className="bg-[#141422] border border-white/[0.06] rounded-2xl p-4 text-sm text-slate-200 whitespace-pre-wrap">{result.instructions}</div>
              )}
              {result.reference && (
                <p className="mt-3 text-sm text-slate-400">Reference: <span className="text-white font-mono">{result.reference}</span></p>
              )}
              <p className="mt-2 text-xs text-slate-500">Payment confirm hone par invoice auto-paid mark ho jayegi.</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
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
          <div className="flex justify-end mb-3 gap-2">
            <button
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => window.open(`/print/invoice/${inv.id}`, '_blank')}
            >
              🖨️ Print invoice
            </button>
            <button
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => {
                const token = typeof window !== 'undefined' ? localStorage.getItem('cw_access') : '';
                const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
                fetch(`${base}/billing/invoices/${inv.id}/pdf`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                })
                  .then((r) => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${inv.number || 'invoice'}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => alert('PDF download failed'));
              }}
            >
              ⬇ Download PDF
            </button>
          </div>
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
              { key: 'receipt', label: '', render: (r) => <button className="btn-secondary btn-sm" onClick={() => window.open(`/print/receipt/${r.id}`, '_blank')}>🧾 Receipt</button> },
            ]}
            rows={payments}
            empty={{ title: 'No payments recorded' }}
          />

          {canRecordPayment && String(inv.status).toLowerCase() !== 'paid' && (
            <form onSubmit={recordPayment} className="mt-4 bg-[#141422] border border-white/[0.06] rounded-2xl p-4">
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
              <div className="flex gap-2">
                <button type="submit" className="btn-primary btn-sm" disabled={paying}>{paying ? 'Recording…' : 'Record payment'}</button>
                <PayOnlineButton invoiceId={inv.id} />
              </div>
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
  const canBulk = ['ceo', 'admin', 'manager', 'super_admin'].includes(user?.role);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [selected, setSelected] = useState(null);
  // Phase 30: bulk selection
  const [bulkIds, setBulkIds] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('paid');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [genMonth, setGenMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState('');
  // Phase 31: proforma invoices — manual create + type filter + convert
  const [typeFilter, setTypeFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [members, setMembers] = useState([]);
  const [createForm, setCreateForm] = useState({ memberId: '', amount: '', dueDate: '', notes: '', invoiceType: 'standard' });
  const [converting, setConverting] = useState('');

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
      const invType = inv.invoiceType || 'standard';
      const matchType = typeFilter === 'all' || invType === typeFilter;
      return matchStatus && matchMonth && matchType;
    });
  }, [invoices, statusFilter, monthFilter, typeFilter]);

  // Phase 31: manual invoice create
  const openCreate = async () => {
    setShowCreate(true);
    setError('');
    try {
      const d = await api.get('/members');
      setMembers(d.members || d || []);
    } catch (e) { /* members list optional */ }
  };
  async function handleCreate(e) {
    e.preventDefault();
    if (!createForm.memberId || !createForm.amount || !createForm.dueDate) {
      setError('Member, amount and due date are required.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await api.post('/billing/invoices', {
        memberId: createForm.memberId,
        amount: Number(createForm.amount),
        dueDate: createForm.dueDate,
        notes: createForm.notes || undefined,
        invoiceType: createForm.invoiceType,
      });
      setShowCreate(false);
      setCreateForm({ memberId: '', amount: '', dueDate: '', notes: '', invoiceType: 'standard' });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }
  async function handleConvert(id) {
    if (!window.confirm('Convert this proforma invoice to a standard invoice? It will get a new INV- number and accept payments.')) return;
    setConverting(id);
    setError('');
    try {
      await api.post(`/billing/invoices/${id}/convert`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setConverting('');
    }
  }

  const dues = useMemo(() => {
    return invoices
      .filter((inv) => String(inv.status).toLowerCase() !== 'paid')
      .map((inv) => ({ ...inv, overdue: daysOverdue(inv.dueDate) }))
      .sort((a, b) => b.overdue - a.overdue);
  }, [invoices]);

  const totalDues = dues.reduce((s, d) => s + Number(d.balance ?? d.amount ?? 0), 0);

  // Phase 31: per-member outstanding vs credit limit (for LIMIT badge)
  const memberCredit = useMemo(() => {
    const map = {};
    for (const inv of dues) {
      const mid = inv.memberId || inv.member?.id;
      if (!mid) continue;
      if (!map[mid]) {
        const lim = inv.member?.creditLimit;
        map[mid] = { balance: 0, limit: lim == null ? null : Number(lim) };
      }
      map[mid].balance += Number(inv.balance ?? inv.amount ?? 0);
    }
    return map;
  }, [dues]);

  function LimitBadge({ memberId }) {
    const c = memberCredit[memberId];
    if (!c || c.limit == null || c.balance <= c.limit) return null;
    return (
      <span className="ml-1.5 text-[10px] font-bold text-red-200 bg-red-500/25 border border-red-500/40 px-1.5 py-0.5 rounded-full align-middle">
        LIMIT
      </span>
    );
  }

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

  // Phase 30: bulk invoice status
  const toggleBulk = (id) => {
    setBulkIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleBulkAll = () => {
    setBulkIds((prev) => (prev.length === filtered.length ? [] : filtered.map((i) => i.id)));
  };
  async function handleBulkStatus() {
    if (bulkIds.length === 0) return;
    if (!window.confirm(`Set ${bulkIds.length} invoice(s) to "${bulkStatus}"? No payment records will be created.`)) return;
    setBulkBusy(true);
    try {
      await api.post('/billing/invoices/bulk/status', { ids: bulkIds, status: bulkStatus });
      setBulkIds([]);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const bulkSelectColumn = canBulk
    ? [
        {
          key: '__select',
          label: <input type="checkbox" checked={filtered.length > 0 && bulkIds.length === filtered.length} onChange={toggleBulkAll} title="Select all" />,
          render: (r) => <input type="checkbox" checked={bulkIds.includes(r.id)} onChange={() => toggleBulk(r.id)} />,
        },
      ]
    : [];

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
              <button className="btn-secondary" onClick={openCreate}>
                + New Invoice
              </button>
            </div>
          )
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />
      {genResult && <div className="bg-green-500/10 border border-green-500/25 text-green-200 text-sm rounded-xl px-4 py-3 mb-4">{genResult}</div>}

      <div className="flex gap-2 mb-4">
        {['invoices', 'dues'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`chip ${tab === t ? 'bg-[#8b5cf6] text-white' : 'bg-[#131322] text-slate-400 border border-white/10 hover:bg-white/5'}`}
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
            <select className="input max-w-[160px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              <option value="standard">Standard</option>
              <option value="proforma">Proforma</option>
            </select>
            {monthFilter && <button className="btn-ghost btn-sm" onClick={() => setMonthFilter('')}>Clear</button>}
          </div>
          {/* Phase 30: bulk actions bar */}
          {canBulk && bulkIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/30">
              <span className="text-sm font-semibold text-[#ddd6fe]">{bulkIds.length} selected</span>
              <select className="input max-w-[160px] !w-auto" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <button className="btn-primary btn-sm" onClick={handleBulkStatus} disabled={bulkBusy}>
                {bulkBusy ? 'Applying…' : 'Apply status'}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setBulkIds([])}>Clear</button>
            </div>
          )}
          <DataTable
            columns={[
              ...bulkSelectColumn,
              { key: 'no', label: 'Invoice', render: (r) => (
                <span className="flex items-center gap-2">
                  <a className="text-violet-400 font-medium cursor-pointer hover:underline" onClick={() => setSelected(r)}>{r.number || r.id?.slice(0, 8) || '—'}</a>
                  {(r.invoiceType || 'standard') === 'proforma' && <Badge tone="amber">PROFORMA</Badge>}
                </span>
              ) },
              { key: 'member', label: 'Member', render: (r) => (<span>{r.memberName || r.member?.name || '—'}<LimitBadge memberId={r.memberId || r.member?.id} /></span>) },
              { key: 'month', label: 'Month', render: (r) => r.month || (r.dueDate ? String(r.dueDate).slice(0, 7) : '—') },
              { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
              { key: 'balance', label: 'Balance', render: (r) => money(r.balance ?? r.amount) },
              { key: 'due', label: 'Due date', render: (r) => (r.dueDate ? String(r.dueDate).slice(0, 10) : '—') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
              { key: 'open', label: '', render: (r) => (
                <div className="flex gap-2">
                  {(r.invoiceType || 'standard') === 'proforma' && r.status !== 'cancelled' && (
                    <button className="btn-primary btn-sm" disabled={converting === r.id} onClick={() => handleConvert(r.id)}>
                      {converting === r.id ? 'Converting…' : 'Convert to Invoice'}
                    </button>
                  )}
                  <button className="btn-secondary btn-sm" onClick={() => window.open(`/print/invoice/${r.id}`, '_blank')}>🖨️ Print</button>
                  <button className="btn-secondary btn-sm" onClick={() => setSelected(r)}>Open</button>
                </div>
              ) },
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
              { key: 'member', label: 'Member', render: (r) => (<span>{r.memberName || r.member?.name || '—'}<LimitBadge memberId={r.memberId || r.member?.id} /></span>) },
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

      {/* Phase 31: manual invoice create (standard / proforma) */}
      {showCreate && (
        <Modal title="New Invoice" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            <Field label="Member">
              <select className="input" value={createForm.memberId} onChange={(e) => setCreateForm({ ...createForm, memberId: e.target.value })} required>
                <option value="">Select member…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name} {m.email ? `(${m.email})` : ''}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (Rs)">
                <input type="number" min="1" step="0.01" className="input" value={createForm.amount} onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })} required />
              </Field>
              <Field label="Due date">
                <input type="date" className="input" value={createForm.dueDate} onChange={(e) => setCreateForm({ ...createForm, dueDate: e.target.value })} required />
              </Field>
            </div>
            <Field label="Type">
              <select className="input" value={createForm.invoiceType} onChange={(e) => setCreateForm({ ...createForm, invoiceType: e.target.value })}>
                <option value="standard">Standard — real invoice, accepts payments</option>
                <option value="proforma">Proforma — estimate only, no payments until converted</option>
              </select>
            </Field>
            <Field label="Notes (optional)">
              <textarea className="input" rows={2} value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} />
            </Field>
            <button type="submit" className="btn-primary w-full" disabled={creating}>
              {creating ? 'Creating…' : `Create ${createForm.invoiceType === 'proforma' ? 'Proforma' : ''} Invoice`}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
