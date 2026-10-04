'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, ErrorBanner, Spinner, EmptyState } from '../../../../components/ui';

function SalesTrendChart({ series }) {
  const max = Math.max(1, ...series.map((s) => s.revenue));
  const W = 640, H = 200, padL = 44, padB = 28;
  const step = (W - padL - 10) / Math.max(1, series.length);
  const bw = Math.min(18, step * 0.62);
  const pts = series.map((s, i) => {
    const x = padL + i * step + step / 2;
    const y = H - padB - ((s.revenue / max) * (H - padB - 14));
    return { x, y, ...s };
  });
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-52">
      {[0.25, 0.5, 0.75, 1].map((f) => {
        const y = H - padB - (H - padB - 14) * f;
        return (
          <g key={f}>
            <line x1={padL} y1={y} x2={W} y2={y} stroke="#ffffff10" />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">
              Rs {Math.round(max * f)}
            </text>
          </g>
        );
      })}
      {series.map((s, i) => {
        const x = padL + i * step + (step - bw) / 2;
        const h = (s.revenue / max) * (H - padB - 14);
        return (
          <rect key={i} x={x} y={H - padB - h} width={bw} height={Math.max(2, h)} rx="3"
            fill="#f59e0b" opacity="0.85">
            <title>{s.date}: Rs {Math.round(s.revenue)} ({s.orders} orders)</title>
          </rect>
        );
      })}
      {pts.length > 1 && <path d={path} fill="none" stroke="#fb923c" strokeWidth="2" opacity="0.7" />}
      {series.length > 12 && (
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b">
          {series[0].date} → {series[series.length - 1].date}
        </text>
      )}
    </svg>
  );
}

const STATUS_COLORS = {
  pending: '#f59e0b', preparing: '#3b82f6', ready: '#22c55e', delivered: '#64748b', cancelled: '#ef4444',
};

export default function CafeDashboardPage() {
  const [stats, setStats] = useState(null);
  const [trend, setTrend] = useState(null);
  const [top, setTop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const load = async (d) => {
    setLoading(true); setError('');
    try {
      const [s, t, ti] = await Promise.all([
        api.get('/cafe/stats'),
        api.get(`/cafe/sales-trend?days=${d}`),
        api.get(`/cafe/top-items?days=${d}&limit=8`),
      ]);
      setStats(s); setTrend(t); setTop(ti);
    } catch (e) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(days); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="p-5"><Spinner /></div>;
  if (error) return <div className="p-5"><ErrorBanner message={error} onRetry={() => load(days)} /></div>;
  if (!stats) return <div className="p-5"><EmptyState title="No data" /></div>;

  const moduleHint = !stats.modules.orders && '⚠️ Orders module abhi migrate nahi hua — yahan data aane ke baad dikhega.';
  const statusEntries = Object.entries(stats.ordersByStatus || {});
  const kitchenLoad = stats.activeOrders;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader title="Cafeteria Dashboard" sub="F&B sales, kitchen load aur top items — ek nazar me" />
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => { setDays(d); load(d); }}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${days === d
                ? 'bg-amber-500 text-black shadow-[0_0_16px_rgba(245,158,11,0.4)]'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-100'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {moduleHint && <ErrorBanner message={moduleHint} />}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Aaj ki sales" value={`Rs ${Math.round(stats.today.revenue).toLocaleString()}`} accent="amber" icon="💰" />
        <StatCard label="Aaj ke orders" value={stats.today.orders} accent="blue" icon="🧾" />
        <StatCard label="Active orders" value={stats.activeOrders} accent="violet" icon="🔥" />
        <StatCard label="Avg prep time" value={stats.avgPrepTimeMin == null ? '—' : `${stats.avgPrepTimeMin} min`} accent="green" icon="⏱️" />
        <StatCard label="Waste cost (aaj)" value={`Rs ${Math.round(stats.wasteCostToday).toLocaleString()}`} accent="red" icon="🗑️" />
        <StatCard label="Meal plan subs" value={stats.modules.mealPlans ? stats.mealPlanSubscribers : '—'} accent="cyan" icon="🍱" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900">Sales trend — {days} din</h3>
            <span className="text-xs text-gray-500">Total: Rs {Math.round((trend?.series || []).reduce((s, x) => s + x.revenue, 0)).toLocaleString()}</span>
          </div>
          {trend && trend.series.length > 0 ? (
            <SalesTrendChart series={trend.series} />
          ) : (
            <EmptyState title="No sales data" hint="Is period me koi order nahi" />
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="font-bold text-gray-900 mb-3">Kitchen load</h3>
          <div className="flex items-center gap-4 mb-4">
            <div className="text-5xl font-extrabold text-amber-400">{kitchenLoad}</div>
            <div className="text-sm text-gray-500">active orders<br />queue me</div>
          </div>
          {statusEntries.length > 0 ? (
            <div className="space-y-2">
              {statusEntries.map(([st, c]) => (
                <div key={st} className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS[st] || '#64748b' }} />
                  <span className="text-gray-600 capitalize">{st}</span>
                  <span className="text-gray-900 font-bold ml-auto">{c}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Koi active order nahi — kitchen free hai ✅</p>
          )}
          <Link href="/cafe/kitchen"
            className="mt-4 inline-block px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-200 text-amber-700 text-sm font-semibold hover:bg-amber-500/25 transition">
            Kitchen display kholo →
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="font-bold text-gray-900 mb-3">Top items ({days} din)</h3>
          {(top?.items || []).length > 0 ? (
            <div className="space-y-2">
              {top.items.map((it, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-100">
                  <span className="text-lg font-extrabold text-amber-400 w-7">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-900 font-semibold truncate">{it.name}</div>
                    <div className="text-xs text-gray-500">{it.qty} sold</div>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-900 font-bold">Rs {Math.round(it.revenue).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No items sold" hint="Abhi koi order data nahi" />
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="font-bold text-gray-900 mb-3">Quick links</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Menu manage', path: '/cafe/menu', icon: '📋' },
              { label: 'Kitchen display', path: '/cafe/kitchen', icon: '👨‍🍳' },
              { label: 'Meal plans', path: '/cafe/meal-plans', icon: '🍱' },
              { label: 'Portal cafe', path: '/portal/cafe', icon: '🛒' },
            ].map((l) => (
              <Link key={l.path} href={l.path}
                className="p-4 rounded-xl bg-gray-100 border border-gray-200 hover:border-amber-400/40 hover:bg-gray-100 transition text-center">
                <div className="text-2xl mb-1">{l.icon}</div>
                <div className="text-sm font-semibold text-gray-800">{l.label}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
