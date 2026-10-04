'use client';

import { useEffect, useState } from 'react';
import { api, API_BASE, getTokens } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

// Monthly profit bar chart: green bars for profit, red for loss (dashboard pattern)
function ProfitChart({ data, height = 220 }) {
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.profit)), 1);
  const barW = 100 / data.length;
  const midY = height - 20 - (height - 40) / 2;
  const scale = (height - 40) / 2 / maxAbs;
  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pnlPosGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="pnlNegGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        <line x1="0" y1={midY} x2="100" y2={midY} stroke="rgba(255,255,255,0.18)" strokeWidth="0.3" strokeDasharray="1.5 1" />
        {data.map((d, i) => {
          const h = Math.max(Math.abs(d.profit) * scale, d.profit === 0 ? 1 : 3);
          const x = i * barW + barW * 0.22;
          const w = barW * 0.56;
          const y = d.profit >= 0 ? midY - h : midY;
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx="1.5" fill={d.profit >= 0 ? 'url(#pnlPosGrad)' : 'url(#pnlNegGrad)'}>
                <animate attributeName="y" from={midY} to={y} dur="0.8s" fill="freeze" />
                <animate attributeName="height" from="0" to={h} dur="0.8s" fill="freeze" />
              </rect>
              <text x={x + w / 2} y={height - 6} textAnchor="middle" fill="rgba(0,0,0,0.55)" fontSize="3.2" fontWeight="600">{d.month.slice(2)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const fmt = (v) => `Rs ${Number(v || 0).toLocaleString()}`;

function Line({ label, value, bold, negative, tone }) {
  return (
    <div className={`flex items-center justify-between py-2.5 border-b border-gray-200 ${bold ? 'font-bold text-gray-900' : ''}`}>
      <span className={bold ? 'text-gray-900' : 'text-gray-600'}>{label}</span>
      <span className={`font-mono ${tone === 'green' ? 'text-emerald-300' : tone === 'red' ? 'text-rose-300' : bold ? 'text-gray-900' : 'text-gray-800'}`}>
        {negative ? '−' : ''}{fmt(Math.abs(value))}
      </span>
    </div>
  );
}

export default function PnlPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin');
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ from, to });
      const res = await api.get(`/pnl?${qs.toString()}`);
      setData(res);
    } catch (e) {
      setError(e.message || 'Failed to load P&L');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const exportCsv = async () => {
    const { access } = getTokens();
    const qs = new URLSearchParams({ from, to });
    const res = await fetch(`${API_BASE}/pnl/export?${qs.toString()}`, {
      headers: access ? { Authorization: `Bearer ${access}` } : {},
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnl-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (allowed === null) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  return (
    <div>
      <PageHeader
        title="P&L Statement"
        sub="Investor profit & loss — cash-basis revenue, approved expenses only"
        actions={<button className="btn-secondary" onClick={exportCsv}>⬇ Export CSV</button>}
      />

      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={load}>Apply</button>
      </div>

      {loading && <Spinner />}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Revenue" value={fmt(data.revenue.total)} sub={`${from} → ${to}`} accent="blue" />
            <StatCard label="Total Expenses" value={fmt(data.expenses.total)} sub="approved only" accent="amber" />
            <StatCard label="Net Profit" value={fmt(data.netProfit)} sub={data.netProfit >= 0 ? 'profitable' : 'loss'} accent={data.netProfit >= 0 ? 'green' : 'red'} />
            <StatCard label="Net Margin" value={`${data.marginPct.toFixed(1)}%`} sub="net / revenue" accent="blue" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="card-premium p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Profit & Loss Statement</h2>
              <div className="text-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Revenue</div>
                <Line label="Contract revenue" value={data.revenue.contract} />
                <Line label="Ad-hoc revenue" value={data.revenue.adhoc} />
                <Line label="Less: refunds" value={data.revenue.refunds} negative />
                <Line label="Total revenue" value={data.revenue.total} bold tone="green" />

                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1 mt-5">Expenses</div>
                {data.expenses.byCategory.map((c) => (
                  <Line key={c.category} label={c.category.replace(/_/g, ' ')} value={c.amount} />
                ))}
                {data.expenses.byCategory.length === 0 && (
                  <div className="text-slate-500 text-sm py-2">No approved expenses in this period.</div>
                )}
                <Line label="Total expenses" value={data.expenses.total} bold tone="red" />

                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1 mt-5">Profit</div>
                <Line label="Gross profit" value={data.grossProfit} />
                <Line label="Net profit" value={data.netProfit} bold tone={data.netProfit >= 0 ? 'green' : 'red'} />
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-gray-600">Net margin</span>
                  <span className="font-mono text-gray-900 font-bold">{data.marginPct.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="card-premium p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-1">Monthly Profit</h2>
              <p className="text-xs text-gray-500 mb-4">Revenue minus expenses per month</p>
              {data.monthly.length === 0 ? (
                <EmptyState title="No data" hint="No activity in this period." />
              ) : (
                <ProfitChart data={data.monthly} />
              )}
            </div>
          </div>

          <div className="card-premium p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Monthly Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-4">Month</th>
                    <th className="py-2 pr-4 text-right">Revenue</th>
                    <th className="py-2 pr-4 text-right">Expenses</th>
                    <th className="py-2 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((m) => (
                    <tr key={m.month} className="border-b border-gray-200">
                      <td className="py-2.5 pr-4 text-gray-600 font-semibold">{m.month}</td>
                      <td className="py-2.5 pr-4 text-right font-mono text-emerald-300">{fmt(m.revenue)}</td>
                      <td className="py-2.5 pr-4 text-right font-mono text-rose-300">{fmt(m.expenses)}</td>
                      <td className={`py-2.5 text-right font-mono font-bold ${m.profit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmt(m.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 text-xs text-slate-500">
              {data.assumptions.join(' ')}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
