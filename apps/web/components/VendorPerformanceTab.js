// ============================================================
// Phase 41 Track 8: VendorPerformanceTab
// VENDOR DETAIL MODAL ME INTEGRATION (coordinator ya track 1 ka agent kare):
//
//   import VendorPerformanceTab from '@/components/VendorPerformanceTab';
//   ...
//   {/* vendor detail modal ke tabs me (Overview | Performance | Ratings): */}
//   <VendorPerformanceTab vendorId={selectedVendor.id} />
//
// Tab 1 — Performance: /api/vendors/:id/performance se auto signals
//   (avg rating, on-time delivery %, disputed bills, total POs, spend)
// Tab 2 — Ratings: /api/vendors/:id/ratings se ratings list + "Rate vendor" form
// ============================================================
'use client';
import { useEffect, useState } from 'react';

const api = (p, opts) =>
  fetch(`/api${p}`, { headers: { 'Content-Type': 'application/json' }, ...opts }).then((r) => r.json());

function Stars({ value, onPick }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick && onPick(s)}
          className={`text-2xl ${s <= Math.round(value || 0) ? 'text-amber-400' : 'text-slate-600'}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const CRITERIA = [
  { key: 'quality', label: 'Quality' },
  { key: 'timeliness', label: 'Timeliness' },
  { key: 'price', label: 'Price' },
];

export default function VendorPerformanceTab({ vendorId }) {
  const [tab, setTab] = useState('perf');
  const [perf, setPerf] = useState(null);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ score: 5, criteria: 'quality', comment: '' });
  const [msg, setMsg] = useState('');

  const load = async () => {
    if (!vendorId) return;
    try {
      const [p, r] = await Promise.all([api(`/vendors/${vendorId}/performance`), api(`/vendors/${vendorId}/ratings`)]);
      setPerf(p.performance || p);
      setData(r);
    } catch (_) {}
  };
  useEffect(() => { load(); }, [vendorId]);

  const submit = async () => {
    setMsg('');
    const r = await api(`/vendors/${vendorId}/rate`, {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (r.error) setMsg(r.error);
    else {
      setMsg('Rating save ho gayi ✓');
      setForm({ score: 5, criteria: 'quality', comment: '' });
      load();
    }
  };

  const stat = (label, value) => (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-bold text-white">{value ?? '—'}</div>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('perf')}
          className={`rounded-lg px-4 py-2 text-sm ${tab === 'perf' ? 'bg-blue-600 text-white' : 'bg-white/10 text-slate-300'}`}
        >
          Performance
        </button>
        <button
          onClick={() => setTab('ratings')}
          className={`rounded-lg px-4 py-2 text-sm ${tab === 'ratings' ? 'bg-blue-600 text-white' : 'bg-white/10 text-slate-300'}`}
        >
          Ratings
        </button>
      </div>

      {tab === 'perf' && perf && (
        <div>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {stat('Avg rating', perf.avgRating != null ? `${perf.avgRating}/5` : '—')}
            {stat('Ratings', perf.ratingCount ?? '—')}
            {stat('On-time delivery', perf.onTimeDeliveryPct != null ? `${perf.onTimeDeliveryPct}%` : '—')}
            {stat('Total POs', perf.totalPOs ?? '—')}
            {stat('Total spend', perf.totalSpend != null ? `Rs ${Number(perf.totalSpend).toLocaleString()}` : '—')}
            {stat('Disputed bills', perf.disputedBills ?? '—')}
          </div>
          <div className="text-xs text-slate-500">
            On-time delivery = smooth GRNs (bina discrepancies) ka % — expected-date field abhi model me nahi hai, is liye smooth-delivery proxy use hota hai.
          </div>
        </div>
      )}

      {tab === 'ratings' && (
        <div>
          <div className="mb-5 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Rate this vendor</div>
            <div className="mb-3 flex flex-wrap items-center gap-4">
              <Stars value={form.score} onPick={(s) => setForm({ ...form, score: s })} />
              <select
                value={form.criteria}
                onChange={(e) => setForm({ ...form, criteria: e.target.value })}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
              >
                {CRITERIA.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              placeholder="Comment (optional)"
              className="mb-3 w-full rounded-lg bg-slate-900 p-2 text-sm text-white"
              rows={2}
            />
            <button onClick={submit} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">
              Save rating
            </button>
            {msg && <div className="mt-2 text-sm text-slate-300">{msg}</div>}
          </div>

          {data?.byCriteria && (
            <div className="mb-4 grid grid-cols-3 gap-3">
              {CRITERIA.map((c) => (
                <div key={c.key} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                  <div className="text-xs text-slate-400">{c.label}</div>
                  <div className="text-xl font-bold text-white">{data.byCriteria[c.key]?.avg ?? '—'}</div>
                  <div className="text-xs text-slate-500">({data.byCriteria[c.key]?.count || 0} votes)</div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {(data?.ratings || []).map((r) => (
              <div key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{r.rater?.name || r.rater?.email || 'Staff'}</span>
                  <Stars value={r.score} />
                </div>
                <div className="text-xs text-slate-400">{r.criteria} • {new Date(r.ratedAt).toLocaleDateString()}</div>
                {r.comment && <div className="mt-1 text-sm text-slate-300">{r.comment}</div>}
              </div>
            ))}
            {!(data?.ratings || []).length && <div className="text-sm text-slate-500">Abhi koi rating nahi hai.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
