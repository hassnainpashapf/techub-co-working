'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

// Stacked SVG bar chart: contracts (blue) + recurring (green) + pipeline (amber)
function StackedBarChart({ data, height = 220 }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const barW = 100 / data.length;
  const segs = [
    { key: 'contracts', color: '#3b82f6', label: 'Contracts' },
    { key: 'recurring', color: '#10b981', label: 'Recurring' },
    { key: 'pipeline', color: '#f59e0b', label: 'Pipeline' },
  ];
  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <filter id="projBarGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={height * f} x2="100" y2={height * f} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
        ))}
        {data.map((d, i) => {
          const h = Math.max((d.total / max) * (height - 34), 2);
          const x = i * barW + barW * 0.24;
          const w = barW * 0.52;
          let y = height - 24;
          return (
            <g key={i} filter="url(#projBarGlow)">
              {segs.map((s) => {
                const sh = d.total > 0 ? (d[s.key] / d.total) * h : 0;
                y -= sh;
                return <rect key={s.key} x={x} y={y} width={w} height={sh} fill={s.color} fillOpacity="0.9" />;
              })}
              <text x={x + w / 2} y={height - 8} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="3" fontWeight="600">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const fmt = (v) => `Rs ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function ProjectionsPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin');
  const [months, setMonths] = useState(12);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (m) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/projections?months=${m}`);
      setData(res);
    } catch (e) {
      setError(e.message || 'Failed to load projections');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(months); }, [allowed, months]);

  if (roleLoading) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const legend = [
    { label: 'Contracts', color: '#3b82f6' },
    { label: 'Recurring invoices', color: '#10b981' },
    { label: 'Pipeline', color: '#f59e0b' },
  ];

  return (
    <div>
      <PageHeader
        title="Revenue Projections"
        sub="Projected revenue from active contracts, recurring invoices and the sales pipeline"
        actions={
          <select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={6}>Next 6 months</option>
            <option value={12}>Next 12 months</option>
            <option value={24}>Next 24 months</option>
          </select>
        }
      />

      {loading && <Spinner />}
      {error && <ErrorBanner message={error} onRetry={() => load(months)} />}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Projected" value={fmt(data.total)} sub={`${data.months} months`} accent="blue" />
            <StatCard label="Contracts" value={fmt(data.breakdown.contracts)} sub={`${data.counts.activeContracts} active`} accent="blue" />
            <StatCard label="Recurring" value={fmt(data.breakdown.recurring)} sub={`${data.counts.activeRecurringInvoices} schedules`} accent="green" />
            <StatCard label="Pipeline" value={fmt(data.breakdown.pipeline)} sub={`${data.counts.openLeads} leads × ${Math.round(data.counts.conversionRate * 100)}%`} accent="amber" />
          </div>

          <div className="card-premium p-6 mb-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-white">Monthly Projection</h2>
              <div className="flex gap-4">
                {legend.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate-300">
                    <span className="inline-block w-3 h-3 rounded" style={{ background: l.color }} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4">Projected revenue per month, stacked by source</p>
            {data.byMonth.length === 0 ? (
              <EmptyState title="No data" hint="No contracts, recurring invoices or leads found." />
            ) : (
              <StackedBarChart data={data.byMonth} />
            )}
          </div>

          <div className="card-premium p-6">
            <h2 className="text-lg font-bold text-white mb-3">Assumptions</h2>
            <ul className="list-disc list-inside text-sm text-slate-300 space-y-1.5">
              {data.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
