'use client';

import { useEffect, useState } from 'react';
import { api, API_BASE, getTokens } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';

// Rich SVG Bar Chart (dashboard pattern)
function BarChart({ data, height = 200 }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = 100 / data.length;
  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="taxBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.25" />
          </linearGradient>
          <filter id="taxBarGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={height * f} x2="100" y2={height * f} stroke="rgba(0,0,0,0.06)" strokeWidth="0.3" />
        ))}
        {data.map((d, i) => {
          const h = Math.max((d.value / max) * (height - 30), 3);
          const x = i * barW + barW * 0.22;
          const w = barW * 0.56;
          return (
            <g key={i}>
              <rect x={x} y={height - 20 - h} width={w} height={h} rx="1.5" fill="url(#taxBarGrad)" filter="url(#taxBarGlow)">
                <animate attributeName="y" from={height - 20} to={height - 20 - h} dur="0.8s" fill="freeze" />
                <animate attributeName="height" from="0" to={h} dur="0.8s" fill="freeze" />
              </rect>
              <text x={x + w / 2} y={height - 6} textAnchor="middle" fill="rgba(0,0,0,0.55)" fontSize="3.2" fontWeight="600">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const fmt = (v) => `Rs ${Number(v || 0).toLocaleString()}`;

export default function TaxReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await api.get(`/tax-reports/summary?${qs.toString()}`);
      setData(res);
    } catch (e) {
      setError(e.message || 'Failed to load tax report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const exportCsv = async () => {
    const { access } = getTokens();
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const res = await fetch(`${API_BASE}/tax-reports/export?${qs.toString()}`, {
      headers: access ? { Authorization: `Bearer ${access}` } : {},
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-report-${from || 'all'}-to-${to || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Tax Reports"
        sub={data ? `Tax rate ${data.taxRate}% — ${data.assumption}` : 'Tax summary by period'}
        actions={
          <button className="btn-secondary" onClick={exportCsv}>⬇ Export CSV</button>
        }
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
            <StatCard label="Total Invoiced" value={fmt(data.totalInvoiced)} sub={`${data.invoiceCount} invoices`} accent="blue" />
            <StatCard label="Tax Amount" value={fmt(data.totalTax)} sub={`@ ${data.taxRate}%`} accent="green" />
            <StatCard label="Total Paid" value={fmt(data.totalPaid)} accent="green" />
            <StatCard label="Outstanding" value={fmt(data.totalOutstanding)} accent="amber" />
          </div>

          <div className="card-premium p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Monthly Tax</h2>
            <p className="text-xs text-gray-500 mb-4">Tax amount per month in the selected period</p>
            {data.byMonth.length === 0 ? (
              <EmptyState title="No data" hint="No invoices found in this period." />
            ) : (
              <BarChart data={data.byMonth.map((m) => ({ label: m.month.slice(2), value: m.tax }))} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
