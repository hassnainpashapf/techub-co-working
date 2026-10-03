'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useRequireRoles } from '../../../../components/Protected';
import { PageHeader, StatCard, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';

const fmt = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;

function monthRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return { from, to };
}

// Revenue vs expenses grouped SVG bar chart
function CompareChart({ rows }) {
  const max = Math.max(...rows.flatMap((r) => [r.revenue, r.expensesAllocated]), 1);
  const h = 190;
  const groupW = rows.length ? 100 / rows.length : 100;
  return (
    <div style={{ height: h }}>
      <svg viewBox={`0 0 100 ${h}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="locRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="locExp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={h * f} x2="100" y2={h * f} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
        ))}
        {rows.map((r, i) => {
          const rh = Math.max((r.revenue / max) * (h - 40), 2);
          const eh = Math.max((r.expensesAllocated / max) * (h - 40), 2);
          const gx = i * groupW;
          return (
            <g key={r.buildingId}>
              <rect x={gx + groupW * 0.2} y={h - 20 - rh} width={groupW * 0.26} height={rh} rx="1.2" fill="url(#locRev)" />
              <rect x={gx + groupW * 0.52} y={h - 20 - eh} width={groupW * 0.26} height={eh} rx="1.2" fill="url(#locExp)" />
              <text x={gx + groupW / 2} y={h - 6} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="3.4" fontWeight="600">
                {(r.name || '').slice(0, 12)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function LocationsComparePage() {
  useRequireRoles('ceo', 'admin', 'super_admin');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (f, t) => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (f) q.set('from', f);
      if (t) q.set('to', t);
      const res = await api.get(`/location-compare?${q.toString()}`);
      setData(res.data || res);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const { from: f, to: t } = monthRange();
    setFrom(f);
    setTo(t);
    load(f, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = (data && data.buildings) || [];
  const totals = (data && data.totals) || {};
  const best = rows.length ? rows[0] : null;
  const worst = rows.length > 1 ? rows[rows.length - 1] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations Comparison"
        subtitle="Building-wise performance: occupancy, revenue, expenses and net"
        actions={
          <div className="flex items-center gap-2">
            <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-500 text-sm">→</span>
            <input type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn-primary btn-sm" onClick={() => load(from, to)}>Apply</button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title="No buildings" message="Add buildings to compare locations." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Revenue" value={fmt(totals.revenue)} accent="green" />
            <StatCard label="Total Expenses" value={fmt(totals.expenses)} accent="red" />
            <StatCard label="Net Profit" value={fmt(totals.net)} accent={totals.net >= 0 ? 'green' : 'red'} />
            <StatCard label="Overall Occupancy" value={`${totals.occupancyPct || 0}%`} accent="blue" />
          </div>

          <div className="card-premium p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Revenue vs Expenses</h2>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" /> Revenue</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block" /> Expenses</span>
              </div>
            </div>
            <CompareChart rows={rows} />
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((r) => {
              const isBest = best && r.buildingId === best.buildingId;
              const isWorst = worst && r.buildingId === worst.buildingId;
              return (
                <div key={r.buildingId} className="card-premium p-5 relative overflow-hidden">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">#{r.rank} {r.name}</h3>
                        {isBest && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">🏆 BEST</span>}
                        {isWorst && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/30">⚠️ WORST</span>}
                      </div>
                      {r.city && <p className="text-xs text-slate-400 mt-0.5">{r.city}</p>}
                    </div>
                    <span className={`text-lg font-extrabold ${r.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmt(r.net)}</span>
                  </div>

                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Occupancy</span>
                      <span className="font-semibold text-slate-200">{r.occupancyPct}% ({r.occupied}/{r.units})</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-700"
                        style={{ width: `${Math.min(r.occupancyPct, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Revenue</p>
                      <p className="font-bold text-emerald-300">{fmt(r.revenue)}</p>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Expenses*</p>
                      <p className="font-bold text-rose-300">{fmt(r.expensesAllocated)}</p>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Units</p>
                      <p className="font-bold text-slate-200">{r.units}</p>
                    </div>
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">Active Members</p>
                      <p className="font-bold text-slate-200">{r.activeMembers}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-600 mt-3">* Expenses allocated by unit share (no building link in data model)</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
