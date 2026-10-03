'use client';

import { useEffect, useState } from 'react';
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

// Rich SVG Bar Chart with glow
function BarChart({ data, height = 180 }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = 100 / data.length;
  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.25" />
          </linearGradient>
          <filter id="barGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={height * f} x2="100" y2={height * f} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
        ))}
        {data.map((d, i) => {
          const h = Math.max((d.value / max) * (height - 30), 3);
          const x = i * barW + barW * 0.22;
          const w = barW * 0.56;
          return (
            <g key={i}>
              <rect x={x} y={height - 20 - h} width={w} height={h} rx="1.5" fill="url(#barGrad)" filter="url(#barGlow)" className="hover:opacity-80 transition-opacity">
                <animate attributeName="y" from={height - 20} to={height - 20 - h} dur="0.8s" fill="freeze" />
                <animate attributeName="height" from="0" to={h} dur="0.8s" fill="freeze" />
              </rect>
              <text x={x + w / 2} y={height - 6} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="3.2" fontWeight="600">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Rich SVG Donut Chart with glow
function DonutChart({ percent, size = 160 }) {
  const r = 62;
  const circ = 2 * Math.PI * r;
  const filled = (percent / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
        <defs>
          <linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <filter id="donutGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="16" />
        <circle cx="80" cy="80" r={r} fill="none" stroke="url(#donutGrad)" strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${filled} ${circ}`} filter="url(#donutGlow)"
          style={{ transition: 'stroke-dasharray 1s ease-out' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-bold text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">{percent}%</span>
        <span className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">Occupied</span>
      </div>
    </div>
  );
}

// Rich SVG Area/Line Chart with glow
function TrendChart({ data, height = 160, color = '#3b82f6' }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = height - 24 - (d.value / max) * (height - 44);
    return `${x},${y}`;
  }).join(' ');
  const area = `0,${height - 20} ${pts} 100,${height - 20}`;
  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
          <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <polygon points={area} fill="url(#areaGrad)" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" filter="url(#lineGlow)" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * 100;
          const y = height - 24 - (d.value / max) * (height - 44);
          return <circle key={i} cx={x} cy={y} r="1.6" fill="#fff" stroke={color} strokeWidth="1" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />;
        })}
      </svg>
      <div className="flex justify-between mt-1 px-0.5">
        {data.map((d, i) => (
          <span key={i} className="text-[10px] font-semibold text-white/45">{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function ChartCard({ title, sub, children, action }) {
  return (
    <div className="rounded-[20px] bg-gradient-to-b from-[#14141f] to-[#0e0e18] border border-white/[0.08] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:border-blue-400/25 hover:shadow-[0_8px_40px_rgba(59,130,246,0.12)] transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-[15px] font-bold text-white">{title}</h3>
          {sub && <p className="text-[12px] text-white/55 font-medium mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function StaffDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [trends, setTrends] = useState(null);
  const [range, setRange] = useState('6m');

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
  const duesList = invoices.filter((i) =>
    ['unpaid', 'partial', 'overdue'].includes((i.status || '').toLowerCase())
  );

  return (
    <div>
      <PageHeader title="Dashboard" sub="Overview of your coworking space" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Occupancy"
          value={`${occupancyPercent}%`}
          sub={`${occ.occupied ?? 0} of ${occ.total ?? 0} units occupied`}
          accent="blue"
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
          sub=""
          accent="green"
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
        <h2 className="font-bold text-white text-[15px]">Trends</h2>
        <div className="flex gap-1">
          {[['3m', '3M'], ['6m', '6M'], ['12m', '1Y']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border ${range === v ? 'border-violet-400/60 bg-violet-500/20 text-violet-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}
            >{l}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <ChartCard title="Revenue Trend" sub={range === '12m' ? 'Last 12 months' : range === '3m' ? 'Last 3 months' : 'Last 6 months'}>
          <BarChart data={revenueData.length ? revenueData : [{ label: '—', value: 0 }]} />
        </ChartCard>
        <ChartCard title="Occupancy" sub={`${occ.occupied ?? 0} of ${occ.total ?? 0} units`}>
          <div className="flex items-center justify-center py-2">
            <DonutChart percent={occupancyPercent} />
          </div>
        </ChartCard>
        <ChartCard title="Bookings" sub={range === '12m' ? 'Last 12 months' : range === '3m' ? 'Last 3 months' : 'Last 6 months'}>
          <TrendChart
            data={bookingData.length ? bookingData : [{ label: '—', value: 0 }]}
            color="#22c55e"
          />
        </ChartCard>
      </div>
      {memberData.some((d) => d.value > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <ChartCard title="New Members" sub="Signups per month">
            <TrendChart data={memberData} color="#8b5cf6" />
          </ChartCard>
          <ChartCard title="Tickets by Status" sub="All time">
            <div className="flex flex-wrap gap-2 py-4">
              {Object.entries(trends?.ticketsByStatus || {}).map(([s, c]) => (
                <span key={s} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200">
                  <span className="capitalize">{s.replace('_', ' ')}</span>: <span className="font-bold text-white">{c}</span>
                </span>
              ))}
              {Object.keys(trends?.ticketsByStatus || {}).length === 0 && (
                <span className="text-sm text-slate-500">No tickets yet</span>
              )}
            </div>
          </ChartCard>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h2 className="font-bold text-white mb-3 text-[15px]">Top pending dues</h2>
          <DataTable
            columns={[
              { key: 'member', label: 'Member', render: (r) => r.memberName || r.member?.name || '—' },
              { key: 'amount', label: 'Amount', render: (r) => money(r.amount || r.balance) },
              { key: 'due', label: 'Due date', render: (r) => r.dueDate ? String(r.dueDate).slice(0, 10) : '—' },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={statusTone(r.status)}>{r.status || 'pending'}</Badge>,
              },
            ]}
            rows={duesList.slice(0, 5)}
            empty={{ title: 'No pending dues', hint: 'All invoices are settled.' }}
          />
        </div>
        <div>
          <h2 className="font-bold text-white mb-3 text-[15px]">Recent invoices</h2>
          <DataTable
            columns={[
              { key: 'no', label: 'Invoice', render: (r) => r.number || r.id?.slice(0, 8) || '—' },
              { key: 'member', label: 'Member', render: (r) => r.memberName || r.member?.name || '—' },
              { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={statusTone(r.status)}>{r.status || 'pending'}</Badge>,
              },
            ]}
            rows={invoices.slice(0, 5)}
            empty={{ title: 'No invoices yet', hint: 'Generate invoices from the Billing page.' }}
          />
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
        <div className="card mb-4">
          <h2 className="font-semibold text-white mb-2">My contract</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-xs text-slate-400">Unit</p><p className="font-medium">{contract.unitCode || contract.space || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Plan</p><p className="font-medium">{contract.plan || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Start</p><p className="font-medium">{contract.startDate ? String(contract.startDate).slice(0, 10) : '—'}</p></div>
            <div><p className="text-xs text-slate-400">End</p><p className="font-medium">{contract.endDate ? String(contract.endDate).slice(0, 10) : '—'}</p></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold text-white mb-3">My dues</h2>
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
          <h2 className="font-semibold text-white mb-3">My bookings</h2>
          <DataTable
            columns={[
              { key: 'title', label: 'Title', render: (r) => r.title || r.room || '—' },
              { key: 'room', label: 'Room', render: (r) => r.roomName || r.unitCode || '—' },
              {
                key: 'when',
                label: 'When',
                render: (r) =>
                  `${r.startTime ? String(r.startTime).slice(0, 16).replace('T', ' ') : '—'}`,
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
