'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

// Line chart: history solid blue, forecast dashed amber
function ForecastChart({ history, forecast, height = 240 }) {
  const all = [...history, ...forecast];
  const W = 100;
  const H = height;
  const padB = 22;
  const max = 1; // occupancy rate 0..1
  const x = (i) => (all.length <= 1 ? 50 : (i / (all.length - 1)) * (W - 4) + 2);
  const y = (v) => (H - padB) - Math.max(0, Math.min(1, v)) * (H - padB - 14) + 8;
  const pts = (arr, offset) => arr.map((d, i) => `${x(offset + i)},${y(d.rate)}`).join(' ');
  const split = history.length;

  return (
    <div className="relative" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="fcArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1="0" y1={y(f)} x2={W} y2={y(f)} stroke="rgba(255,255,255,0.07)" strokeWidth="0.25" />
            <text x={W - 1} y={y(f) - 1.5} textAnchor="end" fill="rgba(0,0,0,0.4)" fontSize="2.8">{Math.round(f * 100)}%</text>
          </g>
        ))}
        {/* history area */}
        <polygon points={`2,${y(0)} ${pts(history, 0)} ${x(split - 1)},${y(0)}`} fill="url(#fcArea)" />
        {/* split line */}
        <line x1={x(split - 0.5)} y1={6} x2={x(split - 0.5)} y2={H - padB} stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="1.2,1" />
        <text x={x(split - 0.5)} y={4.5} textAnchor="middle" fill="rgba(0,0,0,0.45)" fontSize="2.6">today</text>
        {/* history line */}
        <polyline points={pts(history, 0)} fill="none" stroke="#0f766e" strokeWidth="1" strokeLinecap="round" />
        {/* forecast line (dashed) */}
        <polyline points={`${x(split - 1)},${y(history[history.length - 1]?.rate || 0)} ${pts(forecast, split)}`} fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="2,1.4" strokeLinecap="round" />
        {all.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.rate)} r={i < split ? 1.1 : 0.9} fill={i < split ? '#3b82f6' : '#f59e0b'} stroke="#0a0a14" strokeWidth="0.25">
            <title>{d.label}: {(d.rate * 100).toFixed(1)}%</title>
          </circle>
        ))}
        {all.map((d, i) => (
          i % 2 === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fill="rgba(0,0,0,0.5)" fontSize="2.8">{d.label}</text>
          ) : null
        ))}
      </svg>
    </div>
  );
}

const TREND_META = {
  growing: { emoji: '📈', label: 'Growing', cls: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' },
  stable: { emoji: '➖', label: 'Stable', cls: 'border-sky-400/30 bg-sky-500/10 text-sky-200' },
  declining: { emoji: '📉', label: 'Declining', cls: 'border-red-400/30 bg-red-500/10 text-red-200' },
};

export default function ForecastPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin');
  const [months, setMonths] = useState(6);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get(`/forecast/occupancy?months=${months}`);
        setData(res.data || res);
      } catch (e) {
        setError(e.message || 'Failed to load forecast');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [allowed, months]);

  if (roleLoading) return <div className="p-8"><Spinner /></div>;
  if (!allowed) return <AccessDenied />;

  const t = data ? TREND_META[data.trend] || TREND_META.stable : null;
  const a = data?.assumptions;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Occupancy Forecast"
        sub="History vs projected occupancy — simple trend math, no black box"
        actions={
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="input w-36">
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
          </select>
        }
      />

      {loading && <Spinner />}
      {error && <ErrorBanner message={error} />}

      {data && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Current occupancy" value={`${(a.currentOccupancy * 100).toFixed(1)}%`} accent="blue" />
            <StatCard label={`Forecast (${months} mo)`} value={`${(a.forecastOccupancy * 100).toFixed(1)}%`} sub={`trend ${(data.trendPerMonth * 100).toFixed(2)} pts/mo`} accent="amber" />
            <div className="card-premium p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Trend</p>
                <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-semibold ${t.cls}`}>
                  {t.emoji} {t.label}
                </span>
              </div>
            </div>
          </div>

          <div className="card-premium p-6">
            <div className="flex items-center gap-5 mb-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-6 h-0.5 bg-[#0f766e] rounded" /> History</span>
              <span className="flex items-center gap-1.5"><span className="w-6 border-t-2 border-dashed border-amber-500" /> Forecast</span>
            </div>
            {data.history.length === 0 ? (
              <EmptyState title="No data yet" sub="Not enough contract history to forecast." />
            ) : (
              <ForecastChart history={data.history} forecast={data.forecast} />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-premium p-6">
              <h3 className="font-bold text-gray-900 mb-3">📋 How this is calculated</h3>
              <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
                <li>History: % of units with an <b>active contract</b> overlapping each month.</li>
                <li>Trend: linear fit (least squares) over {months} months of history.</li>
                <li>Churn: known contract expiries per future month × (1 − renewal rate).</li>
                <li>Renewal rate: <b>{(a.renewalRate * 100).toFixed(0)}%</b> — {a.renewalRateSource}.</li>
                <li>Pipeline: {a.pendingRequests} pending booking requests × {(a.approvalRate * 100).toFixed(0)}% historical approval rate (short-stay demand).</li>
              </ul>
            </div>
            <div className="card-premium p-6">
              <h3 className="font-bold text-gray-900 mb-3">📅 Monthly breakdown</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.forecast.map((f) => (
                  <div key={f.month} className="flex items-center justify-between text-sm border-b border-gray-200 pb-2">
                    <span className="text-gray-600">{f.label}</span>
                    <span className="text-gray-500">{f.expiring} expiring{f.expiring ? ` (−${f.expectedChurn})` : ''}</span>
                    <span className="font-semibold text-amber-200">{(f.rate * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-3">Estimates only — actuals depend on renewals and new sales. Not a guarantee.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
