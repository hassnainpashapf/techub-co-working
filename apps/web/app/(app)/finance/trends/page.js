'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';
import { useRequireRoles } from '../../../../components/Protected';

const COLORS = ['#0f766e', '#10b981', '#f59e0b', '#ef4444', '#2dd4bf'];
const fmt = (v) => `Rs ${Number(v || 0).toLocaleString()}`;

// Multi-line SVG chart (top categories)
function TrendChart({ data }) {
  const H = 220;
  const { months, monthLabels, matrix, top } = data;
  const max = Math.max(1, ...top.flatMap((c) => matrix[c]));
  const n = months.length;
  const px = (i) => (n === 1 ? 50 : 8 + (i / (n - 1)) * 84);
  const py = (v) => H - 30 - (v / max) * (H - 55);
  return (
    <div className="relative" style={{ height: H }}>
      <svg viewBox={`0 0 100 ${H}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <filter id="trendGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={H * f} x2="100" y2={H * f} stroke="rgba(0,0,0,0.06)" strokeWidth="0.25" />
        ))}
        {top.map((cat, ci) => (
          <g key={cat}>
            <polyline
              points={months.map((_, i) => `${px(i)},${py(matrix[cat][i])}`).join(' ')}
              fill="none" stroke={COLORS[ci % COLORS.length]} strokeWidth="0.9"
              filter="url(#trendGlow)" vectorEffect="non-scaling-stroke"
            />
            {months.map((_, i) => (
              <circle key={i} cx={px(i)} cy={py(matrix[cat][i])} r="1.1" fill={COLORS[ci % COLORS.length]} />
            ))}
          </g>
        ))}
        {months.map((_, i) => (
          <text key={i} x={px(i)} y={H - 8} textAnchor="middle" fill="rgba(0,0,0,0.5)" fontSize="3" fontWeight="600">
            {monthLabels[i]}
          </text>
        ))}
      </svg>
    </div>
  );
}

function TrendArrow({ pct }) {
  if (pct === null || pct === undefined) return <span className="text-gray-500 text-xs">—</span>;
  const up = pct > 0.5;
  const down = pct < -0.5;
  const cls = up ? 'text-red-300' : down ? 'text-emerald-300' : 'text-gray-600';
  const arrow = up ? '▲' : down ? '▼' : '▬';
  return <span className={`${cls} text-xs font-bold`}>{arrow} {Math.abs(pct).toFixed(1)}%</span>;
}

export default function ExpenseTrendsPage() {
  useRequireRoles('ceo', 'admin', 'super_admin', 'finance_officer');
  const [months, setMonths] = useState(12);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/expense-trends?months=${months}`);
      setData(res);
    } catch (e) {
      setError(e.message || 'Failed to load trends');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [months]);

  const top5 = useMemo(() => {
    if (!data) return [];
    return [...data.categories].sort((a, b) => data.totals[b] - data.totals[a]).slice(0, 5);
  }, [data]);

  if (loading) return <Spinner />;
  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Expense Trends" subtitle="Category-wise spend over time with spike detection">
        <div className="flex gap-2">
          {[6, 12].map((m) => (
            <button key={m} onClick={() => setMonths(m)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold ${months === m ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-100'}`}>
              {m} months
            </button>
          ))}
        </div>
      </PageHeader>
      {error && <ErrorBanner message={error} />}

      {data && data.categories.length === 0 && <EmptyState title="No approved expenses yet" />}

      {data && data.categories.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total spend" value={fmt(data.grandTotal)} />
            <StatCard label="Fastest growing" value={data.topGrowing[0] ? data.topGrowing[0].category.replace(/_/g, ' ') : '—'}
              sub={data.topGrowing[0] ? `+${data.topGrowing[0].pct.toFixed(1)}% MoM` : ''} />
            <StatCard label="Spike alerts" value={String(data.anomalies.length)}
              sub={data.anomalies.length ? 'Review below' : 'All normal'} />
          </div>

          <div className="card-premium p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-900 font-bold">Top 5 categories</h3>
              <div className="flex gap-3 flex-wrap">
                {top5.map((c, i) => (
                  <span key={c} className="text-xs text-gray-600 flex items-center gap-1.5">
                    <span className="inline-block w-3 h-1 rounded" style={{ background: COLORS[i % COLORS.length] }} />
                    {c.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
            <TrendChart data={{ ...data, top: top5 }} />
          </div>

          {data.anomalies.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-gray-900 font-bold">⚠️ Spike alerts</h3>
              {data.anomalies.map((a, i) => (
                <div key={i} className="card-premium p-4 border-l-4 border-amber-400 flex justify-between items-center">
                  <div>
                    <p className="text-gray-900 font-semibold capitalize">{a.category.replace(/_/g, ' ')} — {a.month}</p>
                    <p className="text-xs text-gray-500">{fmt(a.amount)} vs {fmt(a.priorAvg)} avg (prior 3 months)</p>
                  </div>
                  <span className="text-amber-300 font-extrabold text-lg">{a.spike}x</span>
                </div>
              ))}
            </div>
          )}

          <div className="card-premium p-6">
            <h3 className="text-gray-900 font-bold mb-4">Category breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase">
                    <th className="pb-3">Category</th>
                    <th className="pb-3 text-right">Total</th>
                    <th className="pb-3 text-right">Avg / month</th>
                    <th className="pb-3 text-right">Last month</th>
                    <th className="pb-3 text-right">MoM trend</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.categories].sort((a, b) => data.totals[b] - data.totals[a]).map((c, ci) => (
                    <tr key={c} className="border-t border-gray-200">
                      <td className="py-3 flex items-center gap-2 text-gray-900 font-medium capitalize">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLORS[ci % COLORS.length] }} />
                        {c.replace(/_/g, ' ')}
                      </td>
                      <td className="py-3 text-right text-gray-800">{fmt(data.totals[c])}</td>
                      <td className="py-3 text-right text-gray-500">{fmt(data.totals[c] / months)}</td>
                      <td className="py-3 text-right text-gray-800">{fmt(data.matrix[c][months - 1])}</td>
                      <td className="py-3 text-right"><TrendArrow pct={data.mom[c]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
