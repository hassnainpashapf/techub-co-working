'use client';

// Phase 41 Track 3: Goods Receipt Notes — pending POs list + receive modal
// (per-item received qty, condition) + discrepancy highlighting.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';

const CONDITIONS = [
  { key: 'good', label: 'Good', tone: 'green' },
  { key: 'damaged', label: 'Damaged', tone: 'red' },
  { key: 'wrong', label: 'Wrong item', tone: 'amber' },
];

const toneFor = (c) => (CONDITIONS.find((x) => x.key === c) || {}).tone || 'slate';
const labelFor = (c) => (CONDITIONS.find((x) => x.key === c) || {}).label || c;

function fmtMoney(n) {
  if (n == null || n === '') return '—';
  return 'Rs ' + Number(n).toLocaleString();
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ReceivingPage() {
  const [pending, setPending] = useState([]);
  const [grns, setGrns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // PO being received
  const [rows, setRows] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('pending'); // pending | history

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [p, g] = await Promise.all([
        api.get('/goods-receipts/pending'),
        api.get('/goods-receipts'),
      ]);
      setPending(p.data?.purchaseOrders || []);
      setGrns(g.data?.grns || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    pending: pending.length,
    partial: grns.filter((g) => g.status === 'partial').length,
    complete: grns.filter((g) => g.status === 'complete').length,
    total: grns.length,
  }), [pending, grns]);

  const openReceive = (po) => {
    setSelected(po);
    setNote('');
    setRows((po.items || []).map((it) => ({
      desc: it.desc || it.name || 'Item',
      orderedQty: Number(it.qty ?? it.quantity ?? it.orderedQty ?? 1),
      receivedQty: Number(it.qty ?? it.quantity ?? it.orderedQty ?? 1),
      condition: 'good',
    })));
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const problems = useMemo(() => rows
    .map((r, i) => {
      const ps = [];
      if (r.receivedQty < r.orderedQty) ps.push(`Row ${i + 1}: received ${r.receivedQty}/${r.orderedQty}`);
      if (r.condition !== 'good') ps.push(`Row ${i + 1}: ${labelFor(r.condition)}`);
      return ps;
    })
    .flat(), [rows]);

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/goods-receipts', {
        poId: selected.id,
        items: rows,
        discrepancies: note || undefined,
      });
      setSelected(null);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Goods Receiving" subtitle="Record what actually arrived against purchase orders" />

      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Pending POs" value={stats.pending} tone="blue" />
        <StatCard label="Complete GRNs" value={stats.complete} tone="green" />
        <StatCard label="Partial / Mismatch" value={stats.partial} tone="amber" />
        <StatCard label="Total GRNs" value={stats.total} tone="slate" />
      </div>

      <div className="flex gap-2 mb-4">
        {[
          { key: 'pending', label: `Pending (${stats.pending})` },
          { key: 'history', label: `History (${stats.total})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-full text-sm ${filter === t.key ? 'bg-[#7c3aed] text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : filter === 'pending' ? (
        pending.length === 0 ? (
          <EmptyState title="Nothing pending" message="All approved purchase orders have been received." />
        ) : (
          <div className="space-y-3">
            {pending.map((po) => (
              <div key={po.id} className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-white">{po.number}</div>
                  <div className="text-sm text-slate-400">
                    {po.vendor?.name || '—'} · {fmtMoney(po.total)} · {po.goodsReceipts?.length || 0} GRN{(po.goodsReceipts?.length || 0) === 1 ? '' : 's'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {(po.items || []).length} line item{(po.items || []).length === 1 ? '' : 's'} · {fmtDate(po.createdAt)}
                  </div>
                </div>
                <Badge tone="blue">{po.status}</Badge>
                <button
                  onClick={() => openReceive(po)}
                  className="px-4 py-2 rounded-lg bg-[#7c3aed] hover:bg-[#8b5cf6] text-white text-sm font-medium"
                >
                  Receive goods
                </button>
              </div>
            ))}
          </div>
        )
      ) : grns.length === 0 ? (
        <EmptyState title="No receipts yet" message="Goods receipts will appear here once POs are received." />
      ) : (
        <div className="space-y-3">
          {grns.map((g) => (
            <div key={g.id} className={`p-4 rounded-xl border ${g.status === 'partial' ? 'bg-amber-500/5 border-amber-500/30' : 'bg-white/5 border-white/10'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-white">
                    {g.purchaseOrder?.number || '—'} <span className="text-slate-500 text-sm">· {g.purchaseOrder?.vendor?.name || '—'}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Received by {g.receiver?.name || '—'} · {fmtDate(g.receivedAt)}
                  </div>
                </div>
                <Badge tone={g.status === 'partial' ? 'amber' : 'green'}>
                  {g.status === 'partial' ? 'Partial / Mismatch' : 'Complete'}
                </Badge>
              </div>
              {g.discrepancies && (
                <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200 whitespace-pre-line">
                  ⚠ {g.discrepancies}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Receive goods — ${selected?.number || ''}`} wide>
        <div className="space-y-3">
          <div className="text-sm text-slate-400">
            Vendor: <span className="text-slate-200">{selected?.vendor?.name || '—'}</span> · PO total: <span className="text-slate-200">{fmtMoney(selected?.total)}</span>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className={`p-3 rounded-lg border ${r.receivedQty < r.orderedQty || r.condition !== 'good' ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 bg-white/5'}`}>
                <div className="font-medium text-white text-sm mb-2">{r.desc}</div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <Field label="Ordered">
                    <input type="number" value={r.orderedQty} disabled className="w-full px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-slate-400 text-sm" />
                  </Field>
                  <Field label="Received">
                    <input
                      type="number" min="0" value={r.receivedQty}
                      onChange={(e) => setRow(i, { receivedQty: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                      className="w-full px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-white text-sm"
                    />
                  </Field>
                  <Field label="Condition">
                    <select
                      value={r.condition}
                      onChange={(e) => setRow(i, { condition: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-white text-sm"
                    >
                      {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </Field>
                </div>
                {(r.receivedQty < r.orderedQty || r.condition !== 'good') && (
                  <div className="mt-1">
                    <Badge tone={toneFor(r.condition)}>{r.receivedQty < r.orderedQty ? `Short: ${r.receivedQty}/${r.orderedQty}` : labelFor(r.condition)}</Badge>
                  </div>
                )}
              </div>
            ))}
          </div>
          {problems.length > 0 && (
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200">
              ⚠ This will be saved as a <b>partial</b> receipt and the finance/manager team will be alerted:
              <ul className="list-disc ml-5 mt-1">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          <Field label="Discrepancy note (optional)">
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="e.g. 2 chairs arrived damaged, supplier notified…"
              className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setSelected(null)} className="px-4 py-2 rounded-lg bg-white/10 text-slate-200 text-sm">Cancel</button>
            <button
              onClick={submit} disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#7c3aed] hover:bg-[#8b5cf6] text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : problems.length ? 'Save partial receipt' : 'Save receipt'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
