'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, ErrorBanner, Spinner, EmptyState, DataTable } from '../../../../components/ui';

const DAY_OPTIONS = [30, 90, 180];
const REASON_COLORS = {
  price: 'bg-red-500',
  location: 'bg-amber-500',
  timing: 'bg-sky-500',
  competitor: 'bg-teal-600',
  no_response: 'bg-slate-500',
  other: 'bg-zinc-400',
};

export default function LostAnalysisPage() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (d) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/leads/lost-analysis?days=${d}`);
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]);

  const maxReason = Math.max(1, ...(data?.byReason?.map((r) => r.count) || [1]));
  const maxFunnel = Math.max(1, ...(data?.funnel?.map((f) => f.count) || [1]));

  return (
    <div>
      <PageHeader
        title="Lost-Lead Analysis"
        sub="Kyun leads haar gaye — reasons, funnel drop-off aur loss rates"
        actions={
          <div className="flex gap-2">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  days === d
                    ? 'bg-[#0f766e] text-white shadow-[0_0_12px_rgba(37,99,235,0.5)]'
                    : 'bg-gray-100 text-gray-600 hover:bg-slate-700'
                }`}
              >
                {d} days
              </button>
            ))}
          </div>
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => load(days)} />}
      {loading && <Spinner />}

      {!loading && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label={`Lost leads (last ${days} days)`} value={data.totalLost} accent="red" />
            <StatCard label="Avg days to lost" value={data.avgDaysToLost ?? '—'} accent="amber" />
            <StatCard label="Top lost reason" value={data.byReason?.slice().sort((a, b) => b.count - a.count)[0]?.label || '—'} accent="blue" />
          </div>

          {/* Reason breakdown */}
          <div className="rounded-xl bg-white/60 border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Reason breakdown</h3>
            {data.totalLost === 0 ? (
              <EmptyState title="No lost leads" hint="Is period me koi lead lost nahi hui — pipeline healthy hai." />
            ) : (
              <div className="space-y-3">
                {data.byReason.map((r) => {
                  const pct = data.totalLost ? Math.round((r.count / data.totalLost) * 100) : 0;
                  return (
                    <div key={r.reason}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-800 font-medium">{r.label}</span>
                        <span className="text-gray-500">{r.count} ({pct}%)</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${REASON_COLORS[r.reason] || 'bg-zinc-400'}`}
                          style={{ width: `${(r.count / maxReason) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Funnel drop-off */}
          <div className="rounded-xl bg-white/60 border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Funnel drop-off (leads created in period)</h3>
            <div className="space-y-3">
              {data.funnel.map((f) => (
                <div key={f.stage}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-800 font-medium capitalize">{f.stage.replace('_', ' ')}</span>
                    <span className="text-gray-500">{f.count} ({f.pct}%)</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${f.stage === 'lost' ? 'bg-red-500' : 'bg-[#0f766e]'}`}
                      style={{ width: `${(f.count / maxFunnel) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Source-wise loss rate */}
          <div className="rounded-xl bg-white/60 border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Source-wise loss rate</h3>
            {data.bySource.length === 0 ? (
              <EmptyState title="No data" hint="Is period me koi leads nahi bani." />
            ) : (
              <DataTable
                columns={['Source', 'Lost', 'Total', 'Loss rate']}
                rows={data.bySource.map((s) => [
                  <span key="s" className="capitalize text-gray-900">{s.source}</span>,
                  s.lost,
                  s.total,
                  <span key="r" className={s.lossRate >= 30 ? 'text-red-400 font-semibold' : 'text-gray-600'}>{s.lossRate}%</span>,
                ])}
              />
            )}
          </div>

          {/* Insights */}
          <div className="rounded-xl bg-white/60 border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Insights</h3>
            <ul className="space-y-2">
              {data.insights.map((ins, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-600">
                  <span className="text-amber-400">💡</span>
                  <span>{ins}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
