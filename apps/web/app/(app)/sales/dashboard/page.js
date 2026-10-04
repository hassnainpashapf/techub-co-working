'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, StatCard, Badge } from '../../../../components/ui';

const STAGE_LABELS = { new: 'New', contacted: 'Contacted', visit: 'Visit', booked: 'Booked (Won)', lost: 'Lost' };
const STAGE_COLORS = { new: '#60a5fa', contacted: '#fbbf24', visit: '#c084fc', booked: '#34d399', lost: '#f87171' };
const FUNNEL_ORDER = ['new', 'contacted', 'visit', 'booked'];

function FunnelChart({ counts }) {
  const max = Math.max(1, ...FUNNEL_ORDER.map((s) => counts[s] || 0));
  const total = FUNNEL_ORDER.reduce((a, s) => a + (counts[s] || 0), 0);
  const W = 560;
  const rowH = 52;
  const H = rowH * FUNNEL_ORDER.length + 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Sales funnel">
      {FUNNEL_ORDER.map((s, i) => {
        const v = counts[s] || 0;
        const w = Math.max(24, (v / max) * (W - 220));
        const y = i * rowH + 4;
        const prev = i === 0 ? null : (counts[FUNNEL_ORDER[i - 1]] || 0);
        const conv = prev ? Math.round((v / prev) * 1000) / 10 : null;
        return (
          <g key={s}>
            <rect x={0} y={y} width={w} height={rowH - 12} rx={10} fill={STAGE_COLORS[s]} opacity={0.85} />
            <text x={12} y={y + 22} fill="#0b1220" fontSize={13} fontWeight={700}>
              {STAGE_LABELS[s]}
            </text>
            <text x={12} y={y + 38} fill="#0b1220" fontSize={11} opacity={0.75}>
              {v} leads
            </text>
            <text x={w + 12} y={y + 30} fill="#cbd5e1" fontSize={12}>
              {total ? `${Math.round((v / total) * 1000) / 10}% of funnel` : ''}
              {conv != null && i > 0 ? ` · ${conv}% of prev` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function SalesDashboardPage() {
  const [funnel, setFunnel] = useState(null);
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [f, l] = await Promise.all([api.get('/api/leads/funnel'), api.get('/api/leads/leaderboard')]);
      setFunnel(f);
      setBoard(l.leaderboard || []);
    } catch (e) {
      setError(e.message || 'Dashboard data load nahi ho saka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Dashboard"
        sub="Funnel, conversion aur team performance"
        actions={<button onClick={load} className="btn-ghost">↻ Refresh</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : funnel ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Open Leads" value={funnel.open ?? 0} accent="blue" />
            <StatCard label="Won (Booked)" value={funnel.won ?? 0} accent="green" />
            <StatCard label="Lost" value={funnel.lost ?? 0} accent="red" />
            <StatCard label="Conversion Rate" value={`${funnel.conversionRate ?? 0}%`} accent="violet" />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Pipeline Funnel</h3>
              <p className="text-xs text-gray-500 mb-4">Stage-wise leads + conversion</p>
              <FunnelChart counts={funnel.counts || {}} />
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="text-gray-500">Avg days in stage:</span>
                {['new', 'contacted', 'visit'].map((s) => (
                  <Badge key={s} tone="slate">
                    {STAGE_LABELS[s]}: {funnel.avgDays?.[s] != null ? `${funnel.avgDays[s]}d` : '—'}
                  </Badge>
                ))}
                <Badge tone="green">Win rate: {funnel.winRate ?? 0}%</Badge>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Deal Cycle</h3>
              <p className="text-xs text-gray-500 mb-4">Won leads ka avg close time (created → closed)</p>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-emerald-700">
                  {funnel.avgDays?.booked != null ? funnel.avgDays.booked : '—'}
                </span>
                <span className="text-gray-500">days average</span>
              </div>
              <p className="mt-3 text-sm text-gray-500">
                Is mahinay: <span className="text-emerald-700 font-semibold">{funnel.won ?? 0} won</span> ·{' '}
                <span className="text-red-700 font-semibold">{funnel.lost ?? 0} lost</span> ·{' '}
                {funnel.total ?? 0} total leads
              </p>
              <div className="mt-4 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                  style={{ width: `${Math.min(100, funnel.conversionRate ?? 0)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Salesperson Leaderboard</h3>
            <p className="text-xs text-gray-500 mb-4">Pichlay 30 din me won deals per assignee</p>
            {board.length === 0 ? (
              <p className="text-sm text-slate-500">Abhi koi won deal nahi.</p>
            ) : (
              <div className="space-y-2">
                {board.map((row, i) => (
                  <div key={row.userId || `row-${i}`} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${i === 0 ? 'bg-amber-400/20 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {i + 1}
                    </span>
                    <span className="flex-1 font-medium text-gray-800">{row.name}</span>
                    <Badge tone="green">{row.won} won</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
