'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import {
  PageHeader,
  DataTable,
  StatCard,
  Spinner,
  ErrorBanner,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

const BUCKETS = [
  { key: 'current', label: 'Current (0–30d)', color: '#34d399' },
  { key: 'd31_60', label: '31–60 days', color: '#fbbf24' },
  { key: 'd61_90', label: '61–90 days', color: '#fb923c' },
  { key: 'd90plus', label: '90+ days', color: '#f87171' },
];

// Red intensity grows with bucket age + share of the member's total.
function amountCell(value, rowTotal) {
  const v = Number(value || 0);
  const share = rowTotal > 0 ? v / rowTotal : 0;
  const intensity = v > 0 ? Math.min(0.25 + share * 0.55, 0.8) : 0;
  return (
    <span
      className="px-2 py-0.5 rounded-md font-medium"
      style={v > 0 ? { backgroundColor: `rgba(248,113,113,${intensity})`, color: '#fff' } : { color: '#64748b' }}
    >
      {money(v)}
    </span>
  );
}

function BucketChart({ totals }) {
  const height = 180;
  const data = BUCKETS.map((b) => ({ ...b, value: Number(totals[b.key] || 0) }));
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {data.map((d, i) => {
        const w = 100 / data.length;
        const h = Math.max((d.value / max) * (height - 28), 3);
        const x = i * w + w * 0.25;
        return (
          <g key={d.key}>
            <rect x={x} y={height - 24 - h} width={w * 0.5} height={h} rx="2" fill={d.color} opacity="0.85">
              <title>{d.label}: {money(d.value)}</title>
            </rect>
            <text x={x + w * 0.25} y={height - 10} fontSize="3.4" fill="#94a3b8" textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function exportCsv(rows, totals) {
  const header = ['Member', 'Current (0-30d)', '31-60 days', '61-90 days', '90+ days', 'Total'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [`"${(r.memberName || '').replace(/"/g, '""')}"`, r.current, r.d31_60, r.d61_90, r.d90plus, r.total].join(',')
    );
  }
  lines.push(['TOTAL', totals.current, totals.d31_60, totals.d61_90, totals.d90plus, totals.total].join(','));
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ar-aging-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ARAgingPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin', 'finance_officer');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ current: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 });

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const d = await api.get('/ar-aging');
        setRows(d.rows || []);
        setTotals(d.totals || { current: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const columns = [
    { key: 'memberName', label: 'Member' },
    ...BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      render: (row) => amountCell(row[b.key], row.total),
    })),
    {
      key: 'total',
      label: 'Total Outstanding',
      render: (row) => <span className="font-bold text-white">{money(row.total)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="AR Aging Report"
        sub="Outstanding receivables by member, bucketed by days past due date"
        actions={
          <button className="btn-secondary" onClick={() => exportCsv(rows, totals)} disabled={!rows.length}>
            ⬇ Export CSV
          </button>
        }
      />
      {error && <ErrorBanner message={error} />}
      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total AR" value={money(totals.total)} accent="blue" />
            <StatCard label="90+ days at risk" value={money(totals.d90plus)} accent="red" />
            <StatCard label="Current (0–30d)" value={money(totals.current)} accent="green" />
            <StatCard label="Members owing" value={rows.length} accent="amber" />
          </div>

          <div className="card-premium p-5 mb-6">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Outstanding by aging bucket</h3>
            <BucketChart totals={totals} />
          </div>

          <div className="card-premium p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Aging by member</h3>
            {rows.length ? (
              <DataTable columns={columns} rows={rows} />
            ) : (
              <p className="text-slate-500 text-sm">No outstanding receivables. 🎉</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
