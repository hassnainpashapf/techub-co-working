'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import {
  PageHeader,
  StatCard,
  DataTable,
  Badge,
  Spinner,
  ErrorBanner,
  EmptyState,
} from '../../../components/ui';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

function statusTone(s) {
  s = (s || '').toLowerCase();
  if (['paid'].includes(s)) return 'green';
  if (['pending', 'partial'].includes(s)) return 'amber';
  if (['overdue', 'unpaid'].includes(s)) return 'red';
  return 'slate';
}

// Measure container width for pixel-crisp SVG rendering (no stretching)
function useChartWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)));
    ro.observe(el);
    setW(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Crisp SVG Bar Chart — rendered at real pixel size, no blur filters
function BarChart({ data, height = 180 }) {
  const [ref, w] = useChartWidth();
  const W = Math.max(w, 50);
  const H = height;
  const padB = 26, padT = 8;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = W / data.length;
  const barW = Math.min(slot * 0.56, 64);
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={(H - padB) * f + padT} x2={W} y2={(H - padB) * f + padT} stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
        ))}
        {data.map((d, i) => {
          const h = Math.max(((d.value / max) * (H - padB - padT - 6)), 3);
          const x = i * slot + (slot - barW) / 2;
          const y = H - padB - h;
          return (
            <g key={i}>
              <rect x={Math.round(x)} y={Math.round(y)} width={Math.round(barW)} height={Math.round(h)} rx="4" fill="url(#barGrad)" />
              <text x={Math.round(i * slot + slot / 2)} y={H - 8} textAnchor="middle" fill="rgba(0,0,0,0.55)" fontSize="11" fontWeight="600">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Multi-segment Donut Chart for distributions
function SegmentDonut({ data, size = 160, colors }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const palette = colors || ['#0f766e', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#9ca3af'];
  return (
    <div className="flex items-center gap-3">
      <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
          <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="18" />
          {data.map((d, i) => {
            const frac = d.value / total;
            const segLen = frac * circ;
            const el = (
              <circle key={i} cx="80" cy="80" r={r} fill="none"
                stroke={palette[i % palette.length]} strokeWidth="18"
                strokeDasharray={`${segLen} ${circ - segLen}`}
                strokeDashoffset={-offset}
                style={{ transition: 'stroke-dasharray 1s ease-out' }} />
            );
            offset += segLen;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[26px] font-bold text-gray-900">{total}</span>
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Total</span>
        </div>
      </div>
      <div className="space-y-2 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
            <span className="text-gray-600 capitalize truncate">{d.label.replace('_', ' ')}</span>
            <span className="font-bold text-gray-900 ml-auto pl-2">{d.value}</span>
          </div>
        ))}
        {data.length === 0 && <span className="text-sm text-gray-500">No data</span>}
      </div>
    </div>
  );
}

// Crisp SVG Donut Chart — no blur filters
function DonutChart({ percent, size = 160 }) {
  const r = 62;
  const circ = 2 * Math.PI * r;
  const filled = (percent / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90 block">
        <defs>
          <linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5eead4" />
            <stop offset="100%" stopColor="#0f766e" />
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="16" />
        <circle cx="80" cy="80" r={r} fill="none" stroke="url(#donutGrad)" strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${filled} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-bold text-gray-900">{percent}%</span>
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Occupied</span>
      </div>
    </div>
  );
}

// Crisp SVG Area/Line Chart — rendered at real pixel size, no blur filters
function TrendChart({ data, height = 160, color = '#0f766e' }) {
  const [ref, w] = useChartWidth();
  const W = Math.max(w, 50);
  const H = height;
  const padB = 28, padT = 10;
  const max = Math.max(...data.map((d) => d.value), 1);
  const px = (i) => (data.length === 1 ? W / 2 : (i / (data.length - 1)) * (W - 8) + 4);
  const py = (v) => H - padB - (v / max) * (H - padB - padT);
  const pts = data.map((d, i) => `${px(i).toFixed(1)},${py(d.value).toFixed(1)}`).join(' ');
  const area = `4,${H - padB} ${pts} ${W - 4},${H - padB}`;
  const gradId = `areaGrad-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H - 20} className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradId})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={i} cx={px(i)} cy={py(d.value)} r="4" fill="#ffffff" stroke={color} strokeWidth="2.5" />
        ))}
      </svg>
      <div className="flex justify-between px-1" style={{ marginTop: 2 }}>
        {data.map((d, i) => (
          <span key={i} className="text-[11px] font-semibold text-gray-500">{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function ChartCard({ title, sub, children, action, icon }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-gray-200 p-5 hover:border-[#0f766e]/35 transition-all duration-200">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#0f766e]/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {icon && <span className="icon-tile w-9 h-9 text-base">{icon}</span>}
          <div>
            <h3 className="text-[15px] font-bold text-gray-900">{title}</h3>
            {sub && <p className="text-[12px] text-gray-900/55 font-medium mt-0.5">{sub}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function timeAgo(t) {
  const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function StaffDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [trends, setTrends] = useState(null);
  const [range, setRange] = useState('6m');
  const [activity, setActivity] = useState([]);

  const rangeParams = () => {
    const to = new Date();
    const from = new Date();
    if (range === '3m') from.setMonth(from.getMonth() - 2);
    else if (range === '12m') from.setMonth(from.getMonth() - 11);
    else from.setMonth(from.getMonth() - 5);
    from.setDate(1);
    return `from=${from.toISOString()}&to=${to.toISOString()}&granularity=month`;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.get('/dashboard'), api.get(`/dashboard/trends?${rangeParams()}`)])
      .then(([d, t]) => {
        if (!cancelled) { setData(d); setTrends(t); }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Activity feed (isolated — never blocks the main dashboard)
  useEffect(() => {
    let cancelled = false;
    api
      .get('/activity/feed?limit=8')
      .then((d) => {
        if (!cancelled) setActivity(d?.items || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={() => window.location.reload()} />;

  const occ = data?.occupancy || {};
  const duesInfo = data?.dues || {};
  const invoices = data?.recentInvoices || data?.invoices || [];

  // Map API response to UI shape
  const occupancyPercent = Math.round((occ.rate ?? 0) * 100);
  const pendingDuesTotal = duesInfo.total ?? 0;
  const unpaidCount = duesInfo.count ?? 0;
  const revenueThisMonth = data?.revenueThisMonth ?? 0;
  const tasksPending = data?.tasksPending ?? 0;

  // Real trend data from API
  const trendLabels = trends?.trends?.labels || [];
  const shortLabel = (l) => {
    // 'YYYY-MM' -> 'Mon'
    const m = l.split('-');
    if (m.length === 2) return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m[1], 10) - 1];
    return l.slice(5);
  };
  const revenueData = trendLabels.map((l, i) => ({ label: shortLabel(l), value: trends.trends.revenue[i] || 0 }));
  const bookingData = trendLabels.map((l, i) => ({ label: shortLabel(l), value: trends.trends.bookings[i] || 0 }));
  const memberData = trendLabels.map((l, i) => ({ label: shortLabel(l), value: trends.trends.members[i] || 0 }));

  // Invoice status distribution (real data)
  const invoiceStatusData = (() => {
    const counts = {};
    invoices.forEach((inv) => {
      const s = (inv.status || 'unknown').toLowerCase();
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  })();
  const INVOICE_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#9ca3af', '#0f766e'];

  // Collection: revenue this month vs pending dues (real data)
  const collectionData = [
    { label: 'Revenue', value: revenueThisMonth },
    { label: 'Dues', value: pendingDuesTotal },
  ];

  // Members vs contracts (real data)
  const memberContractData = [
    { label: 'Members', value: data?.membersActive ?? 0 },
    { label: 'Contracts', value: data?.contractsActive ?? 0 },
  ];
  const duesList = invoices.filter((i) =>
    ['unpaid', 'partial', 'overdue'].includes((i.status || '').toLowerCase())
  );

  // Trend indicators derived from real trend data (last vs previous period)
  const trendOf = (arr) => {
    if (!arr || arr.length < 2) return null;
    const a = arr[arr.length - 1].value || 0;
    const b = arr[arr.length - 2].value || 0;
    if (b === 0) return a > 0 ? { dir: 'up', text: 'new' } : null;
    const pct = Math.round(((a - b) / b) * 100);
    if (pct === 0) return { dir: 'flat', text: '0%' };
    return { dir: pct > 0 ? 'up' : 'down', text: `${pct > 0 ? '+' : ''}${pct}%` };
  };
  const revenueTrend = trendOf(revenueData);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        sub="Overview of your coworking space"
        actions={
          <a
            href="/Techub-debug.apk"
            download
            className="flex items-center gap-2.5 pl-1.5 pr-4 py-1.5 rounded-xl border border-gray-200 bg-white hover:border-[#0f766e]/50 hover:shadow-sm transition-all"
            title="Download the Techub Android app"
          >
            <img src="/techub-icon.png" alt="Techub app" className="w-9 h-9 rounded-lg" />
            <span className="text-left">
              <span className="block text-[13px] font-semibold text-gray-900 leading-tight">Android App</span>
              <span className="block text-[11px] text-[#0f766e] font-medium leading-tight">Download APK</span>
            </span>
          </a>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 4xl:gap-3 mb-3 4xl:mb-3">
        <StatCard
          label="Occupancy"
          value={`${occupancyPercent}%`}
          sub={`${occ.occupied ?? 0} of ${occ.total ?? 0} units occupied`}
          accent="violet"
        />
        <StatCard
          label="Pending dues"
          value={money(pendingDuesTotal)}
          sub={`${unpaidCount} unpaid invoices`}
          accent="red"
        />
        <StatCard
          label="Revenue this month"
          value={money(revenueThisMonth)}
          sub={range === '12m' ? 'last 12 months' : range === '3m' ? 'last 3 months' : 'last 6 months'}
          accent="green"
          trend={revenueTrend}
        />
        <StatCard
          label="Pending tasks"
          value={tasksPending}
          sub=""
          accent="amber"
        />
      </div>

      {/* Rich Charts Row */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900 text-[15px]">Trends</h2>
        <div className="flex gap-1">
          {[['3m', '3M'], ['6m', '6M'], ['12m', '1Y']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border ${range === v ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}
            >{l}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 4xl:gap-3 mb-3 4xl:mb-3">
        <ChartCard title="Revenue Trend" sub={range === '12m' ? 'Last 12 months' : range === '3m' ? 'Last 3 months' : 'Last 6 months'} icon="💰">
          <BarChart data={revenueData.length ? revenueData : [{ label: '—', value: 0 }]} />
        </ChartCard>
        <ChartCard title="Occupancy" sub={`${occ.occupied ?? 0} of ${occ.total ?? 0} units`} icon="🏢">
          <div className="flex items-center justify-center py-2">
            <DonutChart percent={occupancyPercent} />
          </div>
        </ChartCard>
        <ChartCard title="Bookings" sub={range === '12m' ? 'Last 12 months' : range === '3m' ? 'Last 3 months' : 'Last 6 months'} icon="📅">
          <TrendChart
            data={bookingData.length ? bookingData : [{ label: '—', value: 0 }]}
            color="#22c55e"
          />
        </ChartCard>
      </div>
      {/* More charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 4xl:gap-3 mb-3 4xl:mb-3">
        <ChartCard title="New Members" sub="Signups per month" icon="👥">
          <TrendChart data={memberData.length ? memberData : [{ label: '—', value: 0 }]} color="#0f766e" />
        </ChartCard>
        <ChartCard title="Invoice Status" sub="By status" icon="🧾">
          <div className="py-2">
            <SegmentDonut data={invoiceStatusData} colors={INVOICE_COLORS} />
          </div>
        </ChartCard>
        <ChartCard title="Collection" sub="Revenue vs pending dues" icon="💵">
          <BarChart data={collectionData} />
        </ChartCard>
      </div>

      {/* Tickets by status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 4xl:gap-3 mb-3 4xl:mb-3">
        <ChartCard title="Members vs Contracts" sub="Active now" icon="🤝">
          <BarChart data={memberContractData} />
        </ChartCard>
        <ChartCard title="Tickets by Status" sub="All time" icon="🎫">
          <div className="flex flex-wrap gap-2 py-4">
            {Object.entries(trends?.ticketsByStatus || {}).map(([s, c]) => (
              <span key={s} className="px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-sm text-gray-800">
                <span className="capitalize">{s.replace('_', ' ')}</span>: <span className="font-bold text-gray-900">{c}</span>
              </span>
            ))}
            {Object.keys(trends?.ticketsByStatus || {}).length === 0 && (
              <span className="text-sm text-slate-500">No tickets yet</span>
            )}
          </div>
        </ChartCard>
      </div>

      {/* 3 equal cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 4xl:gap-3">
        {/* Recent Activity */}
        <div className="rounded-2xl bg-white border border-gray-200 p-5 flex flex-col min-h-[240px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900 text-[15px]">Recent Activity</h2>
            <button
              onClick={() => (window.location.href = '/settings/audit-logs')}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              View all →
            </button>
          </div>
          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            {activity.length === 0 ? (
              <p className="text-sm text-slate-500 py-3 text-center">No recent activity yet.</p>
            ) : (
              <ul className="space-y-1">
                {activity.slice(0, 7).map((item, i) => (
                  <li key={i} className="flex items-center gap-3 px-2 py-2.5 hover:bg-gray-50 rounded-xl transition-colors">
                    <span className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-base shrink-0">{item.icon || '📝'}</span>
                    <span className="flex-1 text-[13px] text-gray-800 truncate">{item.text}</span>
                    <span className="text-[11px] text-slate-500 shrink-0 font-medium">{timeAgo(item.time)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Top pending dues */}
        <div className="rounded-2xl bg-white border border-gray-200 p-5 flex flex-col min-h-[240px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900 text-[15px]">Top pending dues</h2>
            <button
              onClick={() => (window.location.href = '/billing')}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              View all →
            </button>
          </div>
          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            {duesList.length === 0 ? (
              <p className="text-sm text-slate-500 py-3 text-center">No pending dues. All settled. ✓</p>
            ) : (
              <ul className="space-y-1">
                {duesList.slice(0, 7).map((d, i) => (
                  <li key={i} className="flex items-center gap-3 px-2 py-2.5 hover:bg-gray-50 rounded-xl transition-colors">
                    <span className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-base shrink-0">💰</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold text-gray-900 truncate">{d.memberName || d.member?.name || '—'}</span>
                      <span className="block text-[11px] text-slate-500">Due {d.dueDate ? String(d.dueDate).slice(0, 10) : '—'}</span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-[13px] font-bold text-gray-900">{money(d.amount || d.balance)}</span>
                      <Badge tone={statusTone(d.status)}>{d.status || 'pending'}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Recent invoices */}
        <div className="rounded-2xl bg-white border border-gray-200 p-5 flex flex-col min-h-[240px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900 text-[15px]">Recent invoices</h2>
            <button
              onClick={() => (window.location.href = '/billing')}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              View all →
            </button>
          </div>
          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            {invoices.length === 0 ? (
              <p className="text-sm text-slate-500 py-3 text-center">No invoices yet.</p>
            ) : (
              <ul className="space-y-1">
                {invoices.slice(0, 7).map((inv, i) => (
                  <li key={i} className="flex items-center gap-3 px-2 py-2.5 hover:bg-gray-50 rounded-xl transition-colors">
                    <span className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-base shrink-0">🧾</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold text-gray-900 truncate">{inv.number || inv.id?.slice(0, 8) || '—'}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{inv.memberName || inv.member?.name || '—'}</span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-[13px] font-bold text-gray-900">{money(inv.amount)}</span>
                      <Badge tone={statusTone(inv.status)}>{inv.status || 'pending'}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MemberDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/dashboard')
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={() => window.location.reload()} />;

  const dues = data?.myInvoices || data?.dues || [];
  const bookings = data?.myBookings || data?.bookings || [];
  const contract = data?.myContract || data?.contract;

  return (
    <div>
      <PageHeader title="My Dashboard" sub="Your membership at a glance" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 4xl:gap-3 mb-3 4xl:mb-3">
        <StatCard
          label="My pending dues"
          value={money(data?.myDues ?? dues.reduce((s, r) => s + Number(r.balance || r.amount || 0), 0))}
          sub={`${dues.length} open invoice(s)`}
          accent="red"
        />
        <StatCard
          label="Upcoming bookings"
          value={bookings.length}
          sub="meeting room bookings"
          accent="indigo"
        />
        <StatCard
          label="My space"
          value={contract?.unitCode || contract?.space || '—'}
          sub={contract?.plan || contract?.type || ''}
          accent="green"
        />
      </div>

      {contract && (
        <div className="card mb-3">
          <h2 className="font-semibold text-gray-900 mb-2">My contract</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-xs text-gray-500">Unit</p><p className="font-medium">{contract.unitCode || contract.space || '—'}</p></div>
            <div><p className="text-xs text-gray-500">Plan</p><p className="font-medium">{contract.plan || '—'}</p></div>
            <div><p className="text-xs text-gray-500">Start</p><p className="font-medium">{contract.startDate ? String(contract.startDate).slice(0, 10) : '—'}</p></div>
            <div><p className="text-xs text-gray-500">End</p><p className="font-medium">{contract.endDate ? String(contract.endDate).slice(0, 10) : '—'}</p></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 4xl:gap-3">
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-3">My dues</h2>
          <DataTable
            columns={[
              { key: 'no', label: 'Invoice', render: (r) => r.number || r.id?.slice(0, 8) || '—' },
              { key: 'amount', label: 'Amount', render: (r) => money(r.balance ?? r.amount) },
              { key: 'due', label: 'Due date', render: (r) => (r.dueDate ? String(r.dueDate).slice(0, 10) : '—') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status || 'pending'}</Badge> },
            ]}
            rows={dues.slice(0, 5)}
            empty={{ title: 'No dues', hint: 'You are all paid up.' }}
          />
        </div>
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-3">My bookings</h2>
          <DataTable
            columns={[
              { key: 'title', label: 'Title', render: (r) => r.title || r.room || '—' },
              { key: 'room', label: 'Room', render: (r) => r.roomName || r.unitCode || '—' },
              {
                key: 'when',
                label: 'When',
                render: (r) =>
                  `${r.startAt ? String(r.startAt).slice(0, 16).replace('T', ' ') : '—'}`,
              },
            ]}
            rows={bookings.slice(0, 5)}
            empty={{ title: 'No bookings', hint: 'Book a meeting room from the Bookings page.' }}
          />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user?.role === 'member') return <MemberDashboard />;
  return <StaffDashboard />;
}
