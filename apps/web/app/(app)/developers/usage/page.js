'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, DataTable, StatCard } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function BarsChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.requests));
  const W = 640, H = 180, pad = 8;
  const bw = (W - pad * 2) / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minHeight: 160 }}>
      <defs>
        <linearGradient id="usageBar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const h = Math.max(2, ((H - 40) * d.requests) / max);
        const x = pad + i * bw + bw * 0.2;
        return (
          <g key={d.date}>
            <rect x={x} y={H - 24 - h} width={bw * 0.6} height={h} rx="3" fill="url(#usageBar)" opacity="0.9">
              <title>{d.date}: {d.requests} requests</title>
            </rect>
            {data.length <= 14 && (
              <text x={x + bw * 0.3} y={H - 10} fontSize="9" fill="#64748b" textAnchor="middle">
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function ApiUsagePage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/api-usage?days=${days}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  if (!allowed) return <AccessDenied />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader title="API Usage" subtitle="Requests made with API keys — volume, latency, errors and rate limits" />
      <div className="flex gap-2 mb-4">
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${days === d ? 'border-indigo-400/60 bg-indigo-500/20 text-indigo-200' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}
          >
            {d} days
          </button>
        ))}
      </div>

      {loading && <Spinner />}
      {error && <ErrorBanner message={error} />}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <StatCard label="Total requests" value={data.total.toLocaleString()} icon="📊" />
            <StatCard label="Error rate" value={`${data.errorRate}%`} icon="⚠️" accent={data.errorRate > 5 ? 'red' : 'green'} />
            <StatCard label="Avg latency" value={`${data.avgLatencyMs} ms`} icon="⚡" />
            <StatCard label="Active keys" value={data.activeKeys} icon="🔑" />
          </div>

          <div className="card-premium p-5 mb-4">
            <h3 className="text-sm font-bold text-gray-800 mb-3">Requests per day</h3>
            <BarsChart data={data.perDay} />
          </div>

          <div className="card-premium p-5 mb-4">
            <h3 className="text-sm font-bold text-gray-800 mb-3">Top endpoints</h3>
            <DataTable
              columns={[
                { key: 'method', label: 'Method', render: (r) => <span className="font-mono text-xs px-2 py-0.5 rounded bg-gray-100 text-indigo-300">{r.method}</span> },
                { key: 'endpoint', label: 'Endpoint', render: (r) => <span className="font-mono text-xs text-gray-600">{r.endpoint}</span> },
                { key: 'requests', label: 'Requests', render: (r) => r.requests.toLocaleString() },
                { key: 'avgMs', label: 'Avg ms', render: (r) => `${r.avgMs} ms` },
                { key: 'errors', label: 'Errors', render: (r) => r.errors > 0 ? <Badge tone="red">{r.errors}</Badge> : <span className="text-slate-500">0</span> },
              ]}
              rows={data.topEndpoints}
              empty={{ title: "No API-key traffic in this period." }}
            />
          </div>

          <div className="card-premium p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-3">Top API keys</h3>
            <DataTable
              columns={[
                { key: 'name', label: 'Key', render: (r) => <span className="text-gray-800 font-medium">{r.name} <span className="font-mono text-xs text-slate-500">…{r.keyPrefix}</span></span> },
                { key: 'requests', label: 'Requests', render: (r) => r.requests.toLocaleString() },
                { key: 'errors', label: 'Errors', render: (r) => r.errors > 0 ? <Badge tone="red">{r.errors}</Badge> : <span className="text-slate-500">0</span> },
                {
                  key: 'rateLimitPerMin', label: 'Rate limit', render: (r) =>
                    r.rateLimitPerMin ? <Badge tone="blue">{r.rateLimitPerMin}/min</Badge> : <span className="text-slate-500 text-xs">unlimited</span>,
                },
                { key: 'revoked', label: 'Status', render: (r) => r.revoked ? <Badge tone="red">revoked</Badge> : <Badge tone="green">active</Badge> },
              ]}
              rows={data.topKeys}
              empty={{ title: "No API-key traffic in this period." }}
            />
            <p className="text-xs text-slate-500 mt-3">Set per-key rate limits from <a href="/settings/api-keys" className="text-indigo-300 hover:underline">Settings → API Keys</a>.</p>
          </div>
        </>
      )}
    </div>
  );
}
