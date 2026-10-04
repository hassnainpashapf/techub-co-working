'use client';
// Phase 41 Track 5: Vendor Payments & AP Aging.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Badge, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';

const METHODS = [
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
];

const BUCKETS = [
  { key: 'current', label: 'Current', accent: 'blue' },
  { key: 'd1_30', label: '1–30 days', accent: 'amber' },
  { key: 'd31_60', label: '31–60 days', accent: 'amber' },
  { key: 'd60plus', label: '60+ days', accent: 'red' },
];

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#8b5cf6]/60';
const btnPrimary = 'px-4 py-2 rounded-lg text-sm font-semibold bg-[#7c3aed] hover:bg-[#8b5cf6] text-white transition-all';
const btnGhost = 'px-4 py-2 rounded-lg text-sm font-medium bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10';
const btnSm = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7c3aed] hover:bg-[#8b5cf6] text-white';

export default function VendorPaymentsPage() {
  const [tab, setTab] = useState('aging');
  const [aging, setAging] = useState(null);
  const [payments, setPayments] = useState([]);
  const [unpaidBills, setUnpaidBills] = useState([]);
  const [showPay, setShowPay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState({ billId: '', amount: '', method: 'bank', reference: '', paidAt: '' });
  const [error, setError] = useState('');

  useEffect(() => { load(); }, [tab]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      if (tab === 'aging') {
        const r = await api.get('/api/vendor-payments/aging');
        setAging(r.data);
      } else if (tab === 'history') {
        const r = await api.get('/api/vendor-payments');
        setPayments(r.data.payments || []);
      } else {
        const r = await api.get('/api/vendor-bills');
        setUnpaidBills((r.data.bills || r.data || []).filter((b) => b.status !== 'paid' && b.status !== 'disputed'));
      }
    } catch (e) {
      setError(e?.response?.data?.error || 'Load failed');
    } finally { setLoading(false); }
  }

  async function submitPayment() {
    setError('');
    if (!form.billId || !form.amount) { setError('Bill aur amount lazmi hain'); return; }
    setPaying(true);
    try {
      const r = await api.post('/api/vendor-payments', {
        billId: form.billId,
        amount: Number(form.amount),
        method: form.method,
        reference: form.reference || undefined,
        paidAt: form.paidAt || undefined,
      });
      setShowPay(false);
      setForm({ billId: '', amount: '', method: 'bank', reference: '', paidAt: '' });
      await load();
      alert('Payment record ho gayi' + (r.data.bill?.status === 'paid' ? ' — bill fully paid' : ''));
    } catch (e) {
      setError(e?.response?.data?.error || 'Payment failed');
    } finally { setPaying(false); }
  }

  const selectedBill = unpaidBills.find((b) => b.id === form.billId);
  const outstanding = selectedBill ? Number(selectedBill.amount) - Number(selectedBill.paidAmount || 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Vendor Payments" sub="Bill payments record karein aur AP aging dekhein"
        actions={<button className={btnPrimary} onClick={() => { setError(''); setShowPay(true); }}>+ Record Payment</button>} />
      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2">
        {[{ k: 'aging', l: 'AP Aging' }, { k: 'pay', l: 'Pay Bills' }, { k: 'history', l: 'History' }].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.k ? 'bg-[#7c3aed] text-white shadow-[0_0_16px_rgba(139,92,246,0.4)]' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {loading && <Spinner />}

      {tab === 'aging' && aging && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Total outstanding" value={fmt(aging.totals.total)} accent="blue" />
            {BUCKETS.map((b) => (
              <StatCard key={b.key} label={b.label} value={fmt(aging.totals[b.key])} accent={b.accent} />
            ))}
          </div>
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
            <h3 className="text-white font-semibold mb-3">Vendor-wise aging</h3>
            {aging.vendors.length === 0 ? <EmptyState title="Koi outstanding nahi" hint="Sab bills paid hain" /> : (
              <DataTable
                columns={[
                  { key: 'vendorName', label: 'Vendor' },
                  { key: 'billCount', label: 'Bills' },
                  { key: 'current', label: 'Current', render: (r) => fmt(r.current) },
                  { key: 'd1_30', label: '1–30 days', render: (r) => fmt(r.d1_30) },
                  { key: 'd31_60', label: '31–60 days', render: (r) => fmt(r.d31_60) },
                  { key: 'd60plus', label: '60+ days', render: (r) => <span className="text-red-400 font-semibold">{fmt(r.d60plus)}</span> },
                  { key: 'total', label: 'Total', render: (r) => <strong className="text-white">{fmt(r.total)}</strong> },
                ]}
                rows={aging.vendors}
              />
            )}
          </div>
        </>
      )}

      {tab === 'pay' && !loading && (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
          <h3 className="text-white font-semibold mb-3">Unpaid / partially paid bills</h3>
          {unpaidBills.length === 0 ? <EmptyState title="Koi unpaid bill nahi" hint="Bills list me naye bills add karein" /> : (
            <DataTable
              columns={[
                { key: 'billNo', label: 'Bill #' },
                { key: 'vendor', label: 'Vendor', render: (r) => r.vendor?.name || '—' },
                { key: 'amount', label: 'Amount', render: (r) => fmt(r.amount) },
                { key: 'paidAmount', label: 'Paid', render: (r) => fmt(r.paidAmount) },
                { key: 'outstanding', label: 'Outstanding', render: (r) => <strong className="text-white">{fmt(Number(r.amount) - Number(r.paidAmount || 0))}</strong> },
                { key: 'dueDate', label: 'Due', render: (r) => r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '—' },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'overdue' ? 'red' : 'amber'}>{r.status}</Badge> },
                { key: 'actions', label: '', render: (r) => (
                  <button className={btnSm} onClick={() => { setForm({ billId: r.id, amount: String((Number(r.amount) - Number(r.paidAmount || 0)).toFixed(2)), method: 'bank', reference: '', paidAt: '' }); setError(''); setShowPay(true); }}>
                    Pay
                  </button>
                ) },
              ]}
              rows={unpaidBills}
            />
          )}
        </div>
      )}

      {tab === 'history' && !loading && (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
          <h3 className="text-white font-semibold mb-3">Payment history</h3>
          {payments.length === 0 ? <EmptyState title="Koi payment nahi" hint="Abhi tak koi payment record nahi hui" /> : (
            <DataTable
              columns={[
                { key: 'paidAt', label: 'Paid on', render: (r) => new Date(r.paidAt).toLocaleDateString() },
                { key: 'billNo', label: 'Bill #', render: (r) => r.bill?.billNo || '—' },
                { key: 'vendor', label: 'Vendor', render: (r) => r.bill?.vendor?.name || '—' },
                { key: 'amount', label: 'Amount', render: (r) => fmt(r.amount) },
                { key: 'method', label: 'Method' },
                { key: 'reference', label: 'Reference', render: (r) => r.reference || '—' },
                { key: 'paidBy', label: 'Recorded by', render: (r) => r.paidBy?.name || '—' },
              ]}
              rows={payments}
            />
          )}
        </div>
      )}

      {showPay && (
        <Modal title="Record vendor payment" onClose={() => setShowPay(false)}>
          <div className="space-y-1">
            <Field label="Bill">
              <select className={inputCls} value={form.billId}
                onChange={(e) => { const b = unpaidBills.find((x) => x.id === e.target.value); setForm({ ...form, billId: e.target.value, amount: b ? String((Number(b.amount) - Number(b.paidAmount || 0)).toFixed(2)) : '' }); }}>
                <option value="">Select bill...</option>
                {unpaidBills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.billNo} — {b.vendor?.name} — outstanding {fmt(Number(b.amount) - Number(b.paidAmount || 0))}
                  </option>
                ))}
              </select>
            </Field>
            {selectedBill && <div className="text-sm text-slate-400">Outstanding: <strong className="text-white">{fmt(outstanding)}</strong></div>}
            <Field label="Amount (Rs)">
              <input className={inputCls} type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Method">
              <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Reference (optional)">
              <input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Cheque / transaction no." />
            </Field>
            <Field label="Paid on (optional)">
              <input className={inputCls} type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className={btnGhost} onClick={() => setShowPay(false)}>Cancel</button>
              <button className={btnPrimary} onClick={submitPayment} disabled={paying}>{paying ? 'Saving...' : 'Record payment'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
