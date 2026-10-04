'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, apiDownload } from '../../../../lib/api';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

function fmtMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString()}`;
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_TONE = {
  unpaid: 'amber',
  partial: 'blue',
  paid: 'green',
  overdue: 'red',
  cancelled: 'slate',
};

function isOverdue(inv) {
  if (!inv?.dueDate) return false;
  if (inv.status === 'paid' || inv.status === 'cancelled') return false;
  const due = new Date(inv.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function remaining(inv) {
  return Number(inv.amount || 0) - Number(inv.amountPaid || 0);
}

// ---------------------------------------------------------------- detail modal
function InvoiceDetailModal({ invoiceId, onClose }) {
  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const d = await api.get(`/billing/invoices/${invoiceId}`);
        if (live) setInv(d.invoice);
      } catch (e) {
        if (live) setError(e.message || 'Failed to load invoice');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [invoiceId]);

  const download = async () => {
    setDownloading(true);
    try {
      await apiDownload(`/billing/invoices/${invoiceId}/pdf`, `${inv?.number || 'invoice'}.pdf`);
    } catch (e) {
      setError(e.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal title={`Invoice ${inv?.number || ''}`} onClose={onClose}>
      {loading ? (
        <div className="py-10 flex justify-center"><Spinner /></div>
      ) : error ? (
        <ErrorBanner message={error} />
      ) : inv ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Badge tone={STATUS_TONE[inv.status] || 'slate'}>{inv.status}</Badge>
            {isOverdue(inv) && <Badge tone="red">Overdue</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="text-gray-500 text-xs mb-1">Period</div>
              <div className="text-gray-900 font-medium">{fmtDate(inv.periodStart)} → {fmtDate(inv.periodEnd)}</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="text-gray-500 text-xs mb-1">Due date</div>
              <div className="text-gray-900 font-medium">{fmtDate(inv.dueDate)}</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="text-gray-500 text-xs mb-1">Total</div>
              <div className="text-gray-900 font-bold">{fmtMoney(inv.amount)}</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="text-gray-500 text-xs mb-1">Remaining</div>
              <div className="text-amber-300 font-bold">{fmtMoney(remaining(inv))}</div>
            </div>
          </div>
          {inv.notes && (
            <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="text-gray-500 text-xs mb-1">Notes</div>
              {inv.notes}
            </div>
          )}
          <div>
            <div className="text-gray-600 font-semibold text-sm mb-2">Payments ({inv.payments?.length || 0})</div>
            {!inv.payments?.length ? (
              <p className="text-slate-500 text-sm">No payments recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {inv.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    <div>
                      <div className="text-gray-900 font-medium">{fmtMoney(p.amount)}</div>
                      <div className="text-gray-500 text-xs">{fmtDate(p.paidAt)} · {p.method?.replace(/_/g, ' ')}{p.receiptNo ? ` · ${p.receiptNo}` : ''}</div>
                    </div>
                    <Badge tone="green">received</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={download}
            disabled={downloading}
            className="w-full rounded-xl bg-[#0f766e] hover:bg-[#0f766e] disabled:opacity-50 text-white font-semibold py-2.5 transition"
          >
            {downloading ? 'Downloading…' : '⬇ Download PDF'}
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------- pay / claim modal
const PAY_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'jazzcash', label: 'JazzCash' },
  { value: 'easypaisa', label: 'Easypaisa' },
  { value: 'cash', label: 'Cash (at reception)' },
];

function PayClaimModal({ invoice, onClose, onDone }) {
  const [method, setMethod] = useState('bank_transfer');
  const [amount, setAmount] = useState(remaining(invoice));
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const desc = [
        `Payment claim for invoice ${invoice.number}`,
        `Amount: Rs ${Number(amount).toLocaleString()}`,
        `Method: ${PAY_METHODS.find((m) => m.value === method)?.label || method}`,
        `Paid on: ${paidDate}`,
        reference ? `Reference: ${reference}` : null,
        note ? `Note: ${note}` : null,
      ].filter(Boolean).join('\n');
      await api.post('/tickets', {
        title: `Payment claim — ${invoice.number} (${fmtMoney(amount)})`,
        category: 'billing',
        priority: 'medium',
        description: desc,
      });
      onDone();
    } catch (err) {
      setError(err.message || 'Failed to submit claim');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Pay ${invoice.number}`} onClose={onClose}>
      <div className="bg-[#0f766e]/10 border border-[#0f766e]/30 rounded-xl p-4 text-sm text-gray-600 mb-4">
        <div className="font-semibold text-teal-700 mb-1">How to pay</div>
        <ol className="list-decimal list-inside space-y-1 text-gray-600">
          <li>Transfer <strong className="text-gray-900">{fmtMoney(remaining(invoice))}</strong> via bank transfer, JazzCash or Easypaisa — or pay cash at reception.</li>
          <li>Fill the form below with your payment details.</li>
          <li>Our finance team will verify and record your payment.</li>
        </ol>
      </div>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Amount (Rs)">
            <input className="input" type="number" min="1" max={remaining(invoice)} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
        </div>
        <Field label="Paid on">
          <input className="input" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} required />
        </Field>
        <Field label="Transaction reference (optional)">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. FT123456789" />
        </Field>
        <Field label="Note (optional)">
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything finance should know…" />
        </Field>
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 transition">
          {busy ? 'Submitting…' : '✓ I have paid — notify finance'}
        </button>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- invoice card
function InvoiceCard({ inv, onView, onPay, onPdf }) {
  const overdue = isOverdue(inv);
  return (
    <div className="card-premium p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-gray-900 font-bold">{inv.number}</div>
          <div className="text-gray-500 text-xs mt-0.5">{fmtDate(inv.periodStart)} → {fmtDate(inv.periodEnd)}</div>
        </div>
        <div className="flex gap-2">
          <Badge tone={STATUS_TONE[inv.status] || 'slate'}>{inv.status}</Badge>
          {overdue && <Badge tone="red">Overdue</Badge>}
        </div>
      </div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="text-gray-500 text-xs">Total</div>
          <div className="text-gray-900 font-bold text-lg">{fmtMoney(inv.amount)}</div>
        </div>
        <div className="text-right">
          <div className="text-gray-500 text-xs">Remaining</div>
          <div className={`font-bold text-lg ${remaining(inv) > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{fmtMoney(remaining(inv))}</div>
        </div>
        <div className="text-right">
          <div className="text-gray-500 text-xs">Due</div>
          <div className={`text-sm font-medium ${overdue ? 'text-red-300' : 'text-gray-800'}`}>{fmtDate(inv.dueDate)}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onView(inv)} className="flex-1 min-w-[90px] rounded-xl border border-white/15 text-gray-800 text-sm font-medium py-2 hover:bg-gray-100 transition">View</button>
        <button onClick={() => onPdf(inv)} className="flex-1 min-w-[90px] rounded-xl border border-white/15 text-gray-800 text-sm font-medium py-2 hover:bg-gray-100 transition">PDF</button>
        {remaining(inv) > 0 && inv.status !== 'cancelled' && (
          <button onClick={() => onPay(inv)} className="flex-1 min-w-[90px] rounded-xl bg-[#0f766e] hover:bg-[#0f766e] text-white text-sm font-semibold py-2 transition">Pay now</button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- main page
export default function PortalInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('open');
  const [detailId, setDetailId] = useState(null);
  const [payInv, setPayInv] = useState(null);
  const [claimSent, setClaimSent] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(null);
  const [payments, setPayments] = useState([]);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get('/portal/invoices');
      setInvoices(d.invoices || []);
    } catch (e) {
      setError(e.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadPayments = async () => {
    if (paymentsLoaded || paymentsLoading) return;
    setPaymentsLoading(true);
    try {
      const all = [];
      for (const inv of invoices) {
        try {
          const d = await api.get(`/billing/invoices/${inv.id}`);
          for (const p of d.invoice?.payments || []) {
            all.push({ ...p, invoiceNumber: inv.number });
          }
        } catch { /* skip */ }
      }
      all.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
      setPayments(all);
      setPaymentsLoaded(true);
    } finally {
      setPaymentsLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'payments' && !paymentsLoaded) loadPayments();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useMemo(
    () => invoices.filter((i) => ['unpaid', 'partial', 'overdue'].includes(i.status) || (i.status !== 'paid' && i.status !== 'cancelled' && remaining(i) > 0)),
    [invoices]
  );
  const paid = useMemo(
    () => invoices.filter((i) => i.status === 'paid' || i.status === 'cancelled' || remaining(i) <= 0),
    [invoices]
  );
  const totalDue = useMemo(() => open.reduce((s, i) => s + remaining(i), 0), [open]);
  const overdueCount = useMemo(() => open.filter(isOverdue).length, [open]);

  const downloadPdf = async (inv) => {
    setPdfBusy(inv.id);
    try {
      await apiDownload(`/billing/invoices/${inv.id}/pdf`, `${inv.number}.pdf`);
    } catch (e) {
      setError(e.message || 'Download failed');
    } finally {
      setPdfBusy(null);
    }
  };

  const onClaimDone = () => {
    setPayInv(null);
    setClaimSent(true);
    setTimeout(() => setClaimSent(false), 5000);
  };

  const tabs = [
    { id: 'open', label: `Open (${open.length})` },
    { id: 'paid', label: `Paid (${paid.length})` },
    { id: 'payments', label: 'Payment history' },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Invoices & Payments"
        sub="Your bills, receipts and payment history"
        actions={
          <button
            className="btn-secondary btn-sm"
            onClick={() => apiDownload('/api/member-statements/me/pdf', 'my-statement.pdf')}
          >
            📄 My Statement
          </button>
        }
      />

      {error && <ErrorBanner message={error} />}
      {claimSent && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm rounded-xl px-4 py-3 mb-4">
          ✓ Payment claim sent — finance will verify and record it shortly.
        </div>
      )}

      {loading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <StatCard label="Total due" value={fmtMoney(totalDue)} accent="amber" />
            <StatCard label="Overdue invoices" value={String(overdueCount)} accent={overdueCount > 0 ? 'red' : 'green'} />
            <StatCard label="All invoices" value={String(invoices.length)} accent="blue" />
          </div>

          <div className="flex gap-2 mb-5 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition ${
                  tab === t.id
                    ? 'bg-[#0f766e] text-white shadow-[0_0_16px_rgba(15,118,110,0.45)]'
                    : 'bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab !== 'payments' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(tab === 'open' ? open : paid).map((inv) => (
                <InvoiceCard
                  key={inv.id}
                  inv={inv}
                  onView={(i) => setDetailId(i.id)}
                  onPay={(i) => setPayInv(i)}
                  onPdf={downloadPdf}
                />
              ))}
            </div>
          )}
          {tab !== 'payments' && (tab === 'open' ? open : paid).length === 0 && (
            <EmptyState title={tab === 'open' ? 'No open invoices 🎉' : 'No paid invoices yet'} hint={tab === 'open' ? 'You are all caught up.' : 'Paid invoices will appear here.'} />
          )}

          {tab === 'payments' && (
            paymentsLoading ? (
              <div className="py-12 flex justify-center"><Spinner /></div>
            ) : payments.length === 0 ? (
              <EmptyState title="No payments yet" hint="Your payment history will appear here once finance records a payment." />
            ) : (
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="card-premium p-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-gray-900 font-semibold">{fmtMoney(p.amount)}</div>
                      <div className="text-gray-500 text-xs mt-0.5">
                        {p.invoiceNumber} · {fmtDate(p.paidAt)} · {String(p.method || '').replace(/_/g, ' ')}{p.receiptNo ? ` · ${p.receiptNo}` : ''}
                      </div>
                      {p.note && <div className="text-slate-500 text-xs mt-0.5">{p.note}</div>}
                    </div>
                    <Badge tone="green">received</Badge>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}

      {detailId && <InvoiceDetailModal invoiceId={detailId} onClose={() => setDetailId(null)} />}
      {payInv && <PayClaimModal invoice={payInv} onClose={() => setPayInv(null)} onDone={onClaimDone} />}
      {pdfBusy && <div className="hidden" />}
    </div>
  );
}
