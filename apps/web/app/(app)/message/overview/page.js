'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useChartWidth } from '../../../../components/charts';
import OverviewHero from '../../../../components/OverviewHero';

// ---------- Rich stat card ----------
function RichStatCard({ label, value, sub, icon, grad, topBorder }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 hover:shadow-[0_14px_34px_-12px_rgba(15,118,110,0.28)] hover:-translate-y-1 hover:border-teal-200 transition-all duration-300">
      <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${topBorder}`} />
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">{label}</p>
        </div>
        <span className={`w-12 h-12 rounded-2xl flex items-center justify-center text-[22px] text-white bg-gradient-to-br ${grad} shadow-lg group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
          {icon}
        </span>
      </div>
      <p className="text-[32px] 4xl:text-[42px] font-bold text-gray-900 tracking-tight leading-none">{value}</p>
      {sub && <p className="text-[12.5px] text-gray-500 font-medium mt-2">{sub}</p>}
    </div>
  );
}

// ---------- Full-width dual-series trend chart (sent vs handled) ----------
function DualTrendChart({ labels, sent, handled, height = 280 }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 34, padT = 18, padX = 12;
  const max = Math.max(...sent.map(Number), ...handled.map(Number), 1);
  const n = labels.length;
  const px = (i) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2));
  const py = (v) => H - padB - (Number(v) / max) * (H - padB - padT);
  const mkLine = (vals) => vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const sentLine = mkLine(sent);
  const handledLine = mkLine(handled);
  const sentArea = `${px(0).toFixed(1)},${(H - padB).toFixed(1)} ${sentLine} ${px(n - 1).toFixed(1)},${(H - padB).toFixed(1)}`;
  const grid = [0.25, 0.5, 0.75, 1];
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id="msg-sent-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.30" />
            <stop offset="60%" stopColor="#0f766e" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="msg-sent-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#0f766e" />
          </linearGradient>
        </defs>
        {grid.map((f) => {
          const y = Math.round(H - padB - f * (H - padB - padT));
          return (
            <g key={f}>
              <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="rgba(15,118,110,0.10)" strokeWidth="1" strokeDasharray="4 4" />
              <text x={W - padX} y={y - 5} textAnchor="end" fill="rgba(0,0,0,0.35)" fontSize="11" fontWeight="600">{Math.round(f * max)}</text>
            </g>
          );
        })}
        <polygon points={sentArea} fill="url(#msg-sent-grad)" />
        <polyline points={sentLine} fill="none" stroke="url(#msg-sent-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={handledLine} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 5" />
        {sent.map((v, i) => (
          <circle key={`s${i}`} cx={px(i)} cy={py(v)} r="3.5" fill="#fff" stroke="#0f766e" strokeWidth="2.5">
            <title>{labels[i]}: {Number(v)} sent, {Number(handled[i])} handled</title>
          </circle>
        ))}
        {labels.map((l, i) => (
          <text key={i} x={px(i)} y={H - 12} textAnchor="middle" fill="rgba(0,0,0,0.5)" fontSize="11" fontWeight="600">
            {String(l).slice(0, 8)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ---------- Rich multi-segment donut ----------
function SegmentDonut({ data, size = 190, centerLabel = 'Total' }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const palette = ['#0f766e', '#f59e0b', '#3b82f6', '#8b5cf6', '#22c55e', '#ef4444', '#9ca3af', '#14b8a6'];
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-teal-50 to-emerald-50 blur-sm" />
        <svg viewBox="0 0 160 160" className="relative w-full h-full -rotate-90 drop-shadow-sm">
          <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="20" />
          {data.map((d, i) => {
            const frac = d.value / total;
            const segLen = frac * circ;
            const el = (
              <circle key={i} cx="80" cy="80" r={r} fill="none"
                stroke={palette[i % palette.length]} strokeWidth="20"
                strokeDasharray={`${segLen} ${circ - segLen}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                style={{ transition: 'stroke-dasharray 1s ease-out' }} />
            );
            offset += segLen;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[32px] font-bold text-gray-900 tracking-tight">{total}</span>
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em]">{centerLabel}</span>
        </div>
      </div>
      <div className="w-full sm:flex-1 space-y-1 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors">
            <span className="w-3.5 h-3.5 rounded-[5px] shrink-0 shadow-sm" style={{ background: palette[i % palette.length] }} />
            <span className="text-[13.5px] text-gray-700 font-medium capitalize truncate">{String(d.label).replace(/_/g, ' ')}</span>
            <span className="text-[11px] font-semibold text-gray-400 ml-auto">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            <span className="text-[15px] font-bold text-gray-900 w-7 text-right">{d.value}</span>
          </div>
        ))}
        {data.length === 0 && <span className="text-sm text-gray-500">No data</span>}
      </div>
    </div>
  );
}

const TYPE_ICON = {
  rent_due: '💰',
  contract_expiry: '📄',
  task_assigned: '📝',
  general: '🔔',
};

function typeBadge(type) {
  const t = String(type || 'general').toLowerCase();
  if (t === 'rent_due') return <Badge tone="amber">Rent due</Badge>;
  if (t === 'contract_expiry') return <Badge tone="blue">Contract</Badge>;
  if (t === 'task_assigned') return <Badge tone="violet">Task</Badge>;
  return <Badge tone="slate">General</Badge>;
}

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function isRead(n) {
  return Boolean(n.isRead || n.read || n.readAt);
}

function timeAgo(v) {
  if (!v) return '—';
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return String(v).slice(0, 10);
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function MessageOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const d = await api.get('/notifications?limit=100');
        const items = d.items || d.notifications || (Array.isArray(d) ? d : []);
        if (!cancelled) setNotifications(items);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={() => window.location.reload()} />;

  const today = dayKey(new Date());
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);

  const pending = notifications.filter((n) => !isRead(n));
  const sentToday = notifications.filter((n) => String(n.createdAt || '').slice(0, 10) === today);
  const handled = notifications.filter((n) => isRead(n));
  const sentWeek = notifications.filter((n) => {
    const k = String(n.createdAt || '').slice(0, 10);
    return k && k >= dayKey(weekAgo);
  });

  // Sent vs handled — last 14 days (handled = read, grouped by creation day)
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const byDay = {};
  notifications.forEach((n) => {
    const k = String(n.createdAt || '').slice(0, 10);
    if (!k) return;
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(n);
  });
  const trendLabels = days.map((d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  const sentVals = days.map((d) => (byDay[dayKey(d)] || []).length);
  const handledVals = days.map((d) => (byDay[dayKey(d)] || []).filter(isRead).length);

  // By type donut
  const typeCounts = {};
  notifications.forEach((n) => {
    const t = String(n.type || 'general').toLowerCase();
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  const typeData = Object.entries(typeCounts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // Action needed — newest 6 unread
  const actionNeeded = [...pending]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 6);

  return (
    <div className="pb-4">
      <OverviewHero
        title="Message Overview"
        sub="Reminders & notifications at a glance"
        chips={[
            { label: 'Pending', value: String(pending.length), dot: '#34d399' },
            { label: 'Due today', value: String(sentToday.length), dot: '#fbbf24' },
            { label: 'Sent this week', value: String(sentWeek.length), dot: '#93c5fd' },
          ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 4xl:gap-4 mb-4 4xl:mb-5">
        <RichStatCard
          label="Pending Reminders" value={pending.length} sub="unread notifications"
          icon="🔔" grad="from-amber-500 to-orange-600" topBorder="from-amber-500 to-orange-400"
        />
        <RichStatCard
          label="Sent Today" value={sentToday.length} sub="notifications created today"
          icon="⏰" grad="from-teal-500 to-emerald-600" topBorder="from-teal-500 to-emerald-400"
        />
        <RichStatCard
          label="Handled" value={handled.length} sub="marked as read"
          icon="✅" grad="from-green-500 to-emerald-600" topBorder="from-green-500 to-emerald-400"
        />
        <RichStatCard
          label="Sent This Week" value={sentWeek.length} sub="last 7 days"
          icon="📬" grad="from-blue-500 to-indigo-600" topBorder="from-blue-500 to-indigo-400"
        />
      </div>

      <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5 mb-4 4xl:mb-5">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3.5">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/25">📈</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Sent vs Handled</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Reminders per day — last 14 days</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-[12px] font-bold">
            <span className="inline-flex items-center gap-2 text-teal-700">
              <span className="w-6 h-[3px] rounded-full bg-teal-600" /> Sent
            </span>
            <span className="inline-flex items-center gap-2 text-green-700">
              <span className="w-6 h-[3px] rounded-full bg-green-500" /> Handled
            </span>
          </div>
        </div>
        <DualTrendChart labels={trendLabels} sent={sentVals} handled={handledVals} height={280} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 4xl:gap-4">
        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5">
          <div className="flex items-center gap-3.5 mb-4">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">🍩</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Reminders by Type</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Distribution across categories</p>
            </div>
          </div>
          <SegmentDonut data={typeData} size={190} centerLabel="Reminders" />
        </div>

        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3.5">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/25">⚡</span>
              <div>
                <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Action Needed</h3>
                <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">{actionNeeded.length} unread, newest first</p>
              </div>
            </div>
          </div>
          {actionNeeded.length > 0 ? (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {actionNeeded.map((n) => (
                <div key={n.id} className="flex items-center gap-3.5 px-4 py-3 rounded-2xl border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 hover:-translate-y-px transition-all duration-200">
                  <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-[20px] bg-gradient-to-br from-amber-100 to-orange-100 border border-amber-200/60 shadow-sm shrink-0">
                    {TYPE_ICON[String(n.type || 'general').toLowerCase()] || '🔔'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-gray-900 truncate">
                      {n.title || String(n.message || 'Notification').slice(0, 60)}
                    </p>
                    <p className="text-[12px] text-gray-500 font-medium">{timeAgo(n.createdAt)}</p>
                  </div>
                  {typeBadge(n.type)}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <span className="w-16 h-16 rounded-3xl bg-gradient-to-br from-green-100 to-emerald-200 flex items-center justify-center text-3xl mb-4 shadow-inner">🎉</span>
              <p className="text-[15px] font-bold text-gray-800">All caught up</p>
              <p className="text-[12.5px] text-gray-500 font-medium mt-1 max-w-[240px]">
                No unread reminders. New notifications will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
