'use client';

import { useEffect, useState } from 'react';
import { api, API_BASE, getTokens } from '../../../lib/api';
import {
  PageHeader,
  DataTable,
  StatCard,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

const TABS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'members', label: 'Members' },
  { key: 'bookings', label: 'Bookings' },
];

const defaultRange = () => {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  return { from, to };
};

function BarChart({ data, labelKey, valueKey, height = 160 }) {
  const max = Math.max(...data.map((d) => Number(d[valueKey] || 0)), 1);
  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" y1={height * f} x2="100" y2={height * f} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
      ))}
      {data.map((d, i) => {
        const v = Number(d[valueKey] || 0);
        const w = 100 / Math.max(data.length, 1);
        const h = Math.max((v / max) * (height - 20), 2);
        const x = i * w + w * 0.2;
        return (
          <g key={i}>
            <rect x={x} y={height - 20 - h} width={w * 0.6} height={h} rx="1.5" fill="url(#barGrad)" className="hover:opacity-80 transition-opacity">
              <title>{d[labelKey]}: {v.toLocaleString()}</title>
            </rect>
            {data.length <= 15 && (
              <text x={x + w * 0.3} y={height - 6} fontSize="4" fill="#94a3b8" textAnchor="middle">
                {String(d[labelKey]).slice(-5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ pct, label }) {
  const r = 60;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
          <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="16" />
          <circle cx="80" cy="80" r={r} fill="none" stroke="#3b82f6" strokeWidth="16" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(pct, 100) / 100)} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-2xl font-extrabold text-white">{pct}%</div>
        </div>
      </div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}

async function downloadCsv(type, from, to) {
  const { access } = getTokens();
  const res = await fetch(
    `${API_BASE}/reports/export?type=${type}&from=${from}&to=${to}`,
    { headers: access ? { Authorization: `Bearer ${access}` } : {} }
  );
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-${from}-to-${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function RangeBar({ from, to, setFrom, setTo, groupBy, setGroupBy, exportType, onExported }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1">From</label>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1">To</label>
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {setGroupBy && (
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Group by</label>
          <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="day">Day</option>
          </select>
        </div>
      )}
      <button
        className="btn-secondary ml-auto"
        onClick={async () => {
          try {
            await downloadCsv(exportType, from, to);
            onExported('');
          } catch (e) {
            onExported(e.message);
          }
        }}
      >
        ⬇ Export CSV
      </button>
    </div>
  );
}

export default function ReportsPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'manager', 'finance_officer');
  const [tab, setTab] = useState('revenue');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [{ from, to }, setRange] = useState(defaultRange);
  const [groupBy, setGroupBy] = useState('month');
  const [data, setData] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      let d;
      if (tab === 'revenue') d = await api.get(`/reports/revenue-detail?from=${from}&to=${to}&groupBy=${groupBy}`);
      else if (tab === 'occupancy') d = await api.get(`/reports/occupancy-detail?from=${from}&to=${to}`);
      else if (tab === 'members') d = await api.get('/reports/members');
      else d = await api.get(`/reports/bookings?from=${from}&to=${to}`);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, allowed]);

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;

  const exportMap = { revenue: 'payments', occupancy: 'bookings', members: 'members', bookings: 'bookings' };

  return (
    <div>
      <PageHeader title="Reports & Analytics" sub="Real-time business insights with CSV export" />

      <div className="flex gap-2 mb-5 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} onRetry={fetchData} />
      <RangeBar
        from={from} to={to}
        setFrom={(v) => setRange((r) => ({ ...r, from: v }))}
        setTo={(v) => setRange((r) => ({ ...r, to: v }))}
        groupBy={tab === 'revenue' ? groupBy : null}
        setGroupBy={tab === 'revenue' ? setGroupBy : null}
        exportType={exportMap[tab]}
        onExported={(msg) => msg && setError(msg)}
      />

      {loading ? (
        <Spinner />
      ) : !data ? null : (
        <>
          {tab === 'revenue' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <StatCard label="Collected" value={money(data.totalCollected)} accent="green" />
                <StatCard label="Outstanding" value={money(data.outstanding)} accent="red" />
                <StatCard label="Payments" value={data.paymentCount} accent="blue" />
                <StatCard label="Open invoices" value={data.openInvoiceCount} accent="indigo" />
              </div>
              <div className="card mb-4">
                <h2 className="font-semibold text-white mb-3">Revenue by {groupBy}</h2>
                {data.series.length ? (
                  <BarChart data={data.series} labelKey="period" valueKey="total" />
                ) : (
                  <p className="text-sm text-slate-400">No payments in this range.</p>
                )}
              </div>
              {data.series.length > 0 && (
                <div className="card">
                  <DataTable
                    columns={[
                      { key: 'period', label: 'Period' },
                      { key: 'total', label: 'Collected', render: (r) => money(r.total) },
                    ]}
                    rows={data.series}
                    keyField="period"
                  />
                </div>
              )}
            </>
          )}

          {tab === 'occupancy' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                {data.byType.map((r) => (
                  <div key={r.type} className="card flex items-center justify-between">
                    <Donut pct={r.occupancyPct} label={r.type.replace(/_/g, ' ')} />
                    <div className="text-sm space-y-1">
                      <div className="text-slate-400">Units <span className="text-white font-semibold">{r.totalUnits}</span></div>
                      <div className="text-slate-400">Booked days <span className="text-white font-semibold">{r.bookedDays}</span></div>
                      <div className="text-slate-400">Available <span className="text-white font-semibold">{r.availableDays}</span></div>
                    </div>
                  </div>
                ))}
                {!data.byType.length && <p className="text-sm text-slate-400">No units found.</p>}
              </div>
              {data.byType.length > 0 && (
                <div className="card">
                  <DataTable
                    columns={[
                      { key: 'type', label: 'Unit type', render: (r) => r.type.replace(/_/g, ' ') },
                      { key: 'totalUnits', label: 'Units' },
                      { key: 'bookedDays', label: 'Booked days' },
                      { key: 'availableDays', label: 'Available days' },
                      { key: 'occupancyPct', label: 'Occupancy', render: (r) => `${r.occupancyPct}%` },
                    ]}
                    rows={data.byType}
                    keyField="type"
                  />
                </div>
              )}
            </>
          )}

          {tab === 'members' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <StatCard label="Total members" value={data.total} accent="blue" />
                <StatCard label="Active" value={data.active} accent="green" />
                <StatCard label="Inactive" value={data.inactive} accent="red" />
                <StatCard label="Companies" value={data.topCompanies.length} accent="indigo" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <h2 className="font-semibold text-white mb-3">New members per month</h2>
                  {data.growth.length ? (
                    <BarChart data={data.growth} labelKey="month" valueKey="newMembers" />
                  ) : (
                    <p className="text-sm text-slate-400">No growth data in range.</p>
                  )}
                </div>
                <div className="card">
                  <h2 className="font-semibold text-white mb-3">Top companies by members</h2>
                  {data.topCompanies.length ? (
                    <div className="space-y-3">
                      {data.topCompanies.map((c) => (
                        <div key={c.name}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium text-white">{c.name}</span>
                            <span className="text-slate-400">{c.count} members</span>
                          </div>
                          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${(c.count / data.topCompanies[0].count) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No company data.</p>
                  )}
                </div>
              </div>
            </>
          )}

          {tab === 'bookings' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <StatCard label="Total bookings" value={data.total} accent="blue" />
                <StatCard label="Confirmed" value={data.byStatus.confirmed || 0} accent="green" />
                <StatCard label="Cancelled" value={data.byStatus.cancelled || 0} accent="red" />
                <StatCard
                  label="Peak hour"
                  value={data.peakHours.length ? `${data.peakHours.reduce((a, b) => (b.count > a.count ? b : a)).hour}:00` : '—'}
                  accent="indigo"
                />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <div className="card">
                  <h2 className="font-semibold text-white mb-3">Bookings per day</h2>
                  {data.perDay.length ? (
                    <BarChart data={data.perDay} labelKey="day" valueKey="count" />
                  ) : (
                    <p className="text-sm text-slate-400">No bookings in range.</p>
                  )}
                </div>
                <div className="card">
                  <h2 className="font-semibold text-white mb-3">Peak hours</h2>
                  {data.total ? (
                    <BarChart data={data.peakHours.filter((h) => h.hour >= 6 && h.hour <= 22)} labelKey="hour" valueKey="count" />
                  ) : (
                    <p className="text-sm text-slate-400">No bookings in range.</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <h2 className="font-semibold text-white mb-3">By status</h2>
                  <DataTable
                    columns={[
                      { key: 'status', label: 'Status' },
                      { key: 'count', label: 'Count' },
                    ]}
                    rows={Object.entries(data.byStatus).map(([status, count]) => ({ status, count }))}
                    keyField="status"
                  />
                </div>
                <div className="card">
                  <h2 className="font-semibold text-white mb-3">By unit type</h2>
                  <DataTable
                    columns={[
                      { key: 'type', label: 'Unit type', render: (r) => r.type.replace(/_/g, ' ') },
                      { key: 'count', label: 'Count' },
                    ]}
                    rows={Object.entries(data.byUnitType).map(([type, count]) => ({ type, count }))}
                    keyField="type"
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
