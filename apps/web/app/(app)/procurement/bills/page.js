'use client';

// Phase 41 Track 4: Vendor Bills — list + approve (auto expense) + dispute +
// pay + overdue highlight + 3-way match (PO <-> GRN <-> Bill).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard, DataTable } from '../../../../components/ui';

const STATUS_TONES = {
  pending: 'amber',
  approved: 'blue',
  paid: 'green',
  disputed: 'red',
};

const fmtMoney = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const isOverdue = (b) => ['pending', 'approved'].includes(b.status) && new Date(b.dueDate) < new Date(new Date().toDateString());

function MatchBadge({ match }) {
  if (!match) return <span className="text-slate-500 text-xs">—</span>;
  const chips = [];
  if (match.poLink === 'linked') chips.push({ ok: true, t: 'PO ✓' });
  else chips.push({ ok: false, t: 'No PO' });
  if (match.grnLink === 'received') chips.push({ ok: true, t: 'GRN ✓' });
  else if (match.grnLink === 'not-received') chips.push({ ok: false, t: 'GRN ✗' });
  if (match.amountMatch === 'match') chips.push({ ok: true, t: 'Amt ✓' });
  else if (match.amountMatch === 'mismatch') chips.push({ ok: false, t: 'Amt ✗' });
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span key={i} className={`text-[11px] px-1.5 py-0.5 rounded ${c.ok ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-700'}`}>{c.t}</span>
      ))}
    </span>
  );
}

export default function VendorBillsPage() {
  const [bills, setBills] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [pos, setPos] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [disputeBill, setDisputeBill] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [bd, sd, vd, pd] = await Promise.all([
        api.get('/vendor-bills'),
        api.get('/vendor-bills/stats').catch(() => ({})),
        api.get('/vendors').catch(() => ({ vendors: [] })),
        api.get('/purchase-orders').catch(() => ({ purchaseOrders: [] })),
      ]);
      setBills(bd.bills || []);
      setStats(sd || null);
      setVendors(vd.vendors || vd || []);
      setPos(pd.purchaseOrders || pd.orders || pd || []);
    } catch (e) {
      setError(e.message || 'Failed to load bills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = bills;
    if (status) list = list.filter((b) => b.status === status);
    if (search) list = list.filter((b) => (b.billNo || '').toLowerCase().includes(search.toLowerCase()) || (b.vendor?.name || '').toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [bills, status, search]);

  const doAction = async (bill, action, payload) => {
    setBusy(bill.id); setError('');
    try {
      await api.post(`/vendor-bills/${bill.id}/${action}`, payload || {});
      await load();
    } catch (e) {
      setError(e.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const [form, setForm] = useState({ billNo: '', vendorId: '', poId: '', amount: '', dueDate: new Date().toISOString().slice(0, 10), notes: '' });
  const saveBill = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await api.post('/vendor-bills', {
        billNo: form.billNo.trim(),
        vendorId: form.vendorId,
        poId: form.poId || null,
        amount: Number(form.amount),
        dueDate: form.dueDate,
        notes: form.notes.trim(),
      });
      setShowAdd(false);
      setForm({ billNo: '', vendorId: '', poId: '', amount: '', dueDate: new Date().toISOString().slice(0, 10), notes: '' });
      await load();
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'billNo', label: 'Bill No', render: (b) => <span className="font-semibold">{b.billNo}</span> },
    { key: 'vendor', label: 'Vendor', render: (b) => <span>{b.vendor?.company || b.vendor?.name || '—'}</span> },
    { key: 'po', label: 'PO', render: (b) => <span className="text-gray-600">{b.purchaseOrder?.number || '—'}</span> },
    { key: 'amount', label: 'Amount', render: (b) => <span className="font-semibold">{fmtMoney(b.amount)}</span> },
    {
      key: 'due', label: 'Due Date',
      render: (b) => (
        <span className={isOverdue(b) ? 'text-red-400 font-semibold' : ''}>
          {fmtDate(b.dueDate)}{isOverdue(b) ? ' ⚠' : ''}
        </span>
      ),
    },
    { key: 'status', label: 'Status', render: (b) => <Badge tone={STATUS_TONES[b.status] || 'slate'}>{b.status}</Badge> },
    { key: 'match', label: '3-Way Match', render: (b) => <MatchBadge match={b.match} /> },
    {
      key: 'actions', label: 'Actions',
      render: (b) => (
        <span className="flex gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {['pending', 'disputed'].includes(b.status) && (
            <button className="btn-ghost text-green-400 text-xs" disabled={busy === b.id} onClick={() => doAction(b, 'approve')}>
              {busy === b.id ? '…' : 'Approve'}
            </button>
          )}
          {b.status === 'approved' && (
            <button className="btn-ghost text-teal-700 text-xs" disabled={busy === b.id} onClick={() => doAction(b, 'pay')}>
              {busy === b.id ? '…' : 'Mark Paid'}
            </button>
          )}
          {!['paid', 'disputed'].includes(b.status) && (
            <button className="btn-ghost text-amber-400 text-xs" onClick={() => setDisputeBill(b)}>Dispute</button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Vendor Bills"
        subtitle="Supplier invoices, 3-way match (PO ↔ GRN ↔ Bill), approvals & payments"
        actions={<button className="btn-primary" onClick={() => setShowAdd(true)}>+ New Bill</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <StatCard title="Outstanding" value={fmtMoney(stats.outstanding)} />
          <StatCard title="Overdue" value={`${stats.overdueCount || 0} — ${fmtMoney(stats.overdueValue)}`} tone="red" />
          <StatCard title="Pending" value={stats.counts?.pending || 0} />
          <StatCard title="Disputed" value={stats.counts?.disputed || 0} tone="amber" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <input className="input max-w-xs" placeholder="Search bill no / vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {['', 'pending', 'approved', 'paid', 'disputed'].map((s) => (
          <button key={s} className={`btn-ghost text-xs ${status === s ? '!bg-[#0f766e]/20 !text-teal-700' : ''}`} onClick={() => setStatus(s)}>
            {s === '' ? 'All' : s}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState title="No vendor bills" message="Add your first supplier bill to start tracking payables." />
      ) : (
        <DataTable columns={columns} rows={filtered} />
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Vendor Bill">
        <form onSubmit={saveBill}>
          <Field label="Bill No (vendor's invoice) *">
            <input className="input" value={form.billNo} onChange={(e) => setForm({ ...form, billNo: e.target.value })} required placeholder="e.g. INV-2026-1042" />
          </Field>
          <Field label="Vendor *">
            <select className="input" value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} required>
              <option value="">Select vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.company || v.name}</option>)}
            </select>
          </Field>
          <Field label="Link Purchase Order (optional)">
            <select className="input" value={form.poId} onChange={(e) => setForm({ ...form, poId: e.target.value })}>
              <option value="">No PO</option>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.number} — {fmtMoney(p.total)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount *">
              <input type="number" min="0.01" step="any" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </Field>
            <Field label="Due Date *">
              <input type="date" className="input [color-scheme:dark]" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required />
            </Field>
          </div>
          <Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Create Bill'}</button>
        </form>
      </Modal>

      <Modal open={!!disputeBill} onClose={() => setDisputeBill(null)} title={`Dispute Bill ${disputeBill?.billNo || ''}`}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const reason = e.target.reason.value;
          setDisputeBill(null);
          doAction(disputeBill, 'dispute', { reason });
        }}>
          <Field label="Dispute Reason *">
            <textarea name="reason" className="input" rows={3} required placeholder="e.g. Billed amount higher than PO, items damaged…" />
          </Field>
          <button type="submit" className="btn-primary w-full">Mark as Disputed</button>
        </form>
      </Modal>
    </div>
  );
}
