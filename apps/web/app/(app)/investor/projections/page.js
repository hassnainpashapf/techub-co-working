'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

import { HDStackedBarChart } from '../../../../components/charts';

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
    { label: 'Contracts', color: '#0f766e' },
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard label="Total Projected" value={fmt(data.total)} sub={`${data.months} months`} accent="blue" />
            <StatCard label="Contracts" value={fmt(data.breakdown.contracts)} sub={`${data.counts.activeContracts} active`} accent="blue" />
            <StatCard label="Recurring" value={fmt(data.breakdown.recurring)} sub={`${data.counts.activeRecurringInvoices} schedules`} accent="green" />
            <StatCard label="Pipeline" value={fmt(data.breakdown.pipeline)} sub={`${data.counts.openLeads} leads × ${Math.round(data.counts.conversionRate * 100)}%`} accent="amber" />
          </div>

          <div className="card-premium p-6 mb-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-gray-900">Monthly Projection</h2>
              <div className="flex gap-4">
                {legend.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="inline-block w-3 h-3 rounded" style={{ background: l.color }} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-4">Projected revenue per month, stacked by source</p>
            {data.byMonth.length === 0 ? (
              <EmptyState title="No data" hint="No contracts, recurring invoices or leads found." />
            ) : (
              <HDStackedBarChart data={data.byMonth} height={220} segments={[{key:'contracts',color:'#0f766e',label:'Contracts'},{key:'recurring',color:'#10b981',label:'Recurring'},{key:'pipeline',color:'#f59e0b',label:'Pipeline'}]} />
            )}
          </div>

          <div className="card-premium p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Assumptions</h2>
            <ul className="list-disc list-inside text-sm text-gray-600 space-y-1.5">
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
