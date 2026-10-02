'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  DataTable,
  StatCard,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

function Bar({ value, max, color = 'bg-indigo-500' }) {
  return (
    <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${max ? Math.min((value / max) * 100, 100) : 0}%` }} />
    </div>
  );
}

export default function ReportsPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'finance_officer');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [occupancy, setOccupancy] = useState(null);
  const [revenue, setRevenue] = useState([]);
  const [aging, setAging] = useState([]);

  const refresh = async () => {
    setError('');
    try {
      const [o, r, a] = await Promise.all([
        api.get('/reports/occupancy'),
        api.get(`/reports/revenue?year=${year}`),
        api.get('/reports/dues-aging'),
      ]);
      setOccupancy(o.occupancy || o);
      setRevenue(r.months || r.revenue || r || []);
      setAging(a.buckets || a.aging || a || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  const byFloor = occupancy?.byFloor || [];
  const trend = occupancy?.trend || [];
  const maxTrend = Math.max(...trend.map((t) => Number(t.percent || t.value || 0)), 1);
  const maxRevenue = Math.max(...revenue.map((r) => Number(r.total || r.revenue || 0)), 1);

  return (
    <div>
      <PageHeader title="Reports" sub="Business performance at a glance" />
      <ErrorBanner message={error} onRetry={refresh} />

      {/* Occupancy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-3">Occupancy by floor</h2>
          <div className="space-y-3">
            {(byFloor.length ? byFloor : [{ name: 'All floors', percent: occupancy?.percent ?? 0 }]).map((f, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{f.name || f.floor}</span>
                  <span className="text-slate-500">{f.percent ?? f.value ?? 0}%</span>
                </div>
                <Bar value={Number(f.percent ?? f.value ?? 0)} max={100} color="bg-blue-500" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <StatCard label="Overall" value={`${occupancy?.percent ?? 0}%`} accent="indigo" />
            <StatCard label="Occupied" value={occupancy?.occupied ?? 0} accent="blue" />
            <StatCard label="Vacant" value={occupancy?.vacant ?? occupancy?.total - occupancy?.occupied ?? 0} accent="green" />
          </div>
        </div>

        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-3">Occupancy — last 6 months</h2>
          {trend.length ? (
            <div className="flex items-end gap-2 h-40">
              {trend.slice(-6).map((t, i) => {
                const v = Number(t.percent || t.value || 0);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-medium text-slate-600">{v}%</span>
                    <div
                      className="w-full bg-indigo-500 rounded-t"
                      style={{ height: `${(v / maxTrend) * 100}%`, minHeight: 6 }}
                    />
                    <span className="text-[10px] text-slate-500">{t.label || t.month || `M${i + 1}`}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No trend data available.</p>
          )}
        </div>
      </div>

      {/* Revenue */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Revenue by month — {year}</h2>
          <input type="number" className="input !w-32" value={year} min="2020" max="2100" onChange={(e) => setYear(e.target.value)} />
        </div>
        <DataTable
          columns={[
            { key: 'month', label: 'Month', render: (r) => r.label || r.month || '—' },
            {
              key: 'revenue',
              label: 'Revenue',
              render: (r) => (
                <div className="flex items-center gap-3 min-w-[220px]">
                  <span className="font-medium w-28">{money(r.total || r.revenue)}</span>
                  <div className="flex-1"><Bar value={Number(r.total || r.revenue || 0)} max={maxRevenue} color="bg-green-500" /></div>
                </div>
              ),
            },
            { key: 'invoices', label: 'Invoices', render: (r) => r.count ?? r.invoices ?? '—' },
          ]}
          rows={revenue}
          empty={{ title: 'No revenue data', hint: 'Try a different year.' }}
        />
      </div>

      {/* Dues aging */}
      <div className="card">
        <h2 className="font-semibold text-slate-900 mb-3">Dues aging</h2>
        <DataTable
          columns={[
            { key: 'bucket', label: 'Bucket', render: (r) => r.label || r.bucket || '—' },
            { key: 'count', label: 'Invoices', render: (r) => r.count ?? 0 },
            { key: 'amount', label: 'Amount', render: (r) => <span className="font-medium">{money(r.amount || r.total)}</span> },
          ]}
          rows={aging}
          empty={{ title: 'No overdue dues', hint: 'All dues are current.' }}
        />
      </div>
    </div>
  );
}
