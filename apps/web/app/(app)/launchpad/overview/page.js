'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';
import { useChartWidth } from '../../../../components/charts';
import OverviewHero from '../../../../components/OverviewHero';

// ---------- Rich stat card ----------
function RichStatCard({ label, value, sub, icon, grad, topBorder }) {
  return (
    <div className={`group relative overflow-hidden rounded-2xl bg-white border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 hover:shadow-[0_14px_34px_-12px_rgba(15,118,110,0.28)] hover:-translate-y-1 hover:border-teal-200 transition-all duration-300`}>
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

// ---------- Dual-series gradient area chart (created vs completed) ----------
function DualAreaTrendChart({ labels, seriesA, seriesB, height = 280 }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 34, padT = 16, padX = 12;
  const max = Math.max(...seriesA.map(Number), ...seriesB.map(Number), 1);
  const n = labels.length;
  const px = (i) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2));
  const py = (v) => H - padB - (Number(v) / max) * (H - padB - padT);
  const line = (vals) => vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = (vals) => `${px(0).toFixed(1)},${(H - padB).toFixed(1)} ${line(vals)} ${px(n - 1).toFixed(1)},${(H - padB).toFixed(1)}`;
  const grid = [0.25, 0.5, 0.75, 1];
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id="lp-a-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lp-b-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
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
        <polygon points={area(seriesB)} fill="url(#lp-b-grad)" />
        <polygon points={area(seriesA)} fill="url(#lp-a-grad)" />
        <polyline points={line(seriesB)} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 0" opacity="0.9" />
        <polyline points={line(seriesA)} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {seriesA.map((v, i) => (
          <circle key={i} cx={px(i)} cy={py(v)} r="3.5" fill="#fff" stroke="#0f766e" strokeWidth="2.5">
            <title>{labels[i]}: {Number(v)} completed</title>
          </circle>
        ))}
        {labels.map((l, i) => (
          <text key={i} x={px(i)} y={H - 12} textAnchor="middle" fill="rgba(0,0,0,0.5)" fontSize="11" fontWeight="600">
            {String(l).slice(0, 8)}
          </text>
        ))}
      </svg>
      <div className="absolute top-0 right-1 flex items-center gap-4 text-[12px] font-semibold text-gray-600">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-teal-700" /> Completed</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500" /> Created</span>
      </div>
    </div>
  );
}

// ---------- Rich multi-segment donut ----------
function SegmentDonut({ data, centerLabel, size = 190 }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const palette = ['#3b82f6', '#f59e0b', '#8b5cf6', '#22c55e', '#9ca3af', '#0f766e', '#ef4444', '#14b8a6'];
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-50 to-indigo-50 blur-sm" />
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

const AVATAR_GRADS = [
  'from-teal-500 to-emerald-600',
  'from-blue-500 to-indigo-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
];

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

function gradFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 997;
  return AVATAR_GRADS[h % AVATAR_GRADS.length];
}

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

const OPEN_TICKET = ['open', 'in_progress', 'on_hold'];

export default function LaunchpadOverviewPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'office_boy');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [events, setEvents] = useState([]);
  const [visitors, setVisitors] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [t, tk, ev, vs] = await Promise.all([
          api.get('/tasks').catch(() => ({ tasks: [] })),
          api.get('/tickets').catch(() => ({ tickets: [] })),
          api.get('/events?all=1').catch(() => ({ events: [] })),
          api.get('/visitors?today=true').catch(() => ({ visitors: [] })),
        ]);
        if (!cancelled) {
          setTasks(t.tasks || t || []);
          setTickets(tk.tickets || tk || []);
          setEvents(ev.events || ev || []);
          setVisitors(vs.visitors || vs || []);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={() => window.location.reload()} />;

  const today = dayKey(new Date());

  // ---- stat computations ----
  const openTasks = tasks.filter((t) => String(t.status).toLowerCase() !== 'done');
  const openTickets = tickets.filter((t) => OPEN_TICKET.includes(String(t.status).toLowerCase()));
  const upcomingEvents = events.filter((e) => {
    const s = String(e.startsAt || e.starts_at || '').slice(0, 10);
    if (!s) return false;
    const plus30 = dayKey(new Date(Date.now() + 30 * 86400000));
    return s >= today && s <= plus30;
  });

  // ---- task flow: created vs completed, last 14 days ----
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const trendLabels = days.map((d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  const createdValues = days.map((d) => {
    const k = dayKey(d);
    return tasks.filter((t) => String(t.createdAt || t.created_at || '').slice(0, 10) === k).length;
  });
  const completedValues = days.map((d) => {
    const k = dayKey(d);
    return tasks.filter((t) => {
      const c = String(t.completedAt || t.completed_at || t.updatedAt || t.updated_at || '').slice(0, 10);
      return String(t.status).toLowerCase() === 'done' && c === k;
    }).length;
  });
  const totalCompleted = completedValues.reduce((a, b) => a + b, 0);

  // ---- tickets by status ----
  const ticketOrder = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'];
  const ticketCounts = {};
  tickets.forEach((t) => {
    const s = String(t.status || 'open').toLowerCase();
    ticketCounts[s] = (ticketCounts[s] || 0) + 1;
  });
  const ticketData = ticketOrder
    .map((s) => ({ label: s, value: ticketCounts[s] || 0 }))
    .filter((d) => d.value > 0);
  if (ticketData.length === 0) ticketData.push({ label: 'No tickets', value: 0 });

  // ---- needs attention: overdue tasks + urgent open tickets ----
  const overdueTasks = openTasks
    .filter((t) => t.dueDate && String(t.dueDate).slice(0, 10) < today)
    .map((t) => ({
      key: `task-${t.id}`,
      kind: 'task',
      title: t.title || 'Untitled task',
      meta: `Due ${String(t.dueDate).slice(0, 10)}${t.assignee?.name ? ` · ${t.assignee.name}` : ''}`,
      urgent: true,
    }));
  const urgentTickets = openTickets
    .filter((t) => String(t.priority || '').toLowerCase() === 'urgent')
    .map((t) => ({
      key: `ticket-${t.id}`,
      kind: 'ticket',
      title: t.title || 'Untitled ticket',
      meta: `#${t.ticketNumber || '—'}${t.assignedTo?.name ? ` · ${t.assignedTo.name}` : ''}`,
      urgent: true,
    }));
  const needsAttention = [...overdueTasks, ...urgentTickets].slice(0, 6);

  return (
    <div className="pb-4">
      <OverviewHero
        title="Launchpad Overview"
        sub="Operations at a glance"
        chips={[
            { label: 'Open tasks', value: String(openTasks.length), dot: '#34d399' },
            { label: 'Open tickets', value: String(openTickets.length), dot: '#fbbf24' },
            { label: 'Upcoming events', value: String(upcomingEvents.length), dot: '#93c5fd' },
          ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 4xl:gap-6 mb-6 4xl:mb-8">
        <RichStatCard
          label="Open Tasks" value={openTasks.length} sub={`${tasks.length} total tasks`}
          icon="📋" grad="from-teal-500 to-emerald-600" topBorder="from-teal-500 to-emerald-400"
        />
        <RichStatCard
          label="Open Tickets" value={openTickets.length} sub={`${tickets.length} total tickets`}
          icon="🎫" grad="from-blue-500 to-indigo-600" topBorder="from-blue-500 to-indigo-400"
        />
        <RichStatCard
          label="Upcoming Events" value={upcomingEvents.length} sub="next 30 days"
          icon="📅" grad="from-violet-500 to-purple-600" topBorder="from-violet-500 to-purple-400"
        />
        <RichStatCard
          label="Today's Visitors" value={visitors.length} sub="checked in today"
          icon="🧑‍💼" grad="from-green-500 to-emerald-600" topBorder="from-green-500 to-emerald-400"
        />
      </div>

      <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-8 mb-6 4xl:mb-8">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3.5">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/25">📈</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Task Flow</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Created vs completed — last 14 days</p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 text-[12px] font-bold text-teal-700">
            <span className="w-2 h-2 rounded-full bg-teal-600" /> {totalCompleted} completed
          </span>
        </div>
        <DualAreaTrendChart labels={trendLabels} seriesA={completedValues} seriesB={createdValues} height={280} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 4xl:gap-6">
        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-8">
          <div className="flex items-center gap-3.5 mb-6">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">🍩</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Tickets by Status</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Support ticket pipeline</p>
            </div>
          </div>
          <SegmentDonut data={ticketData} centerLabel="Tickets" size={190} />
        </div>

        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3.5">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-rose-500 to-red-600 shadow-lg shadow-rose-500/25">⚠️</span>
              <div>
                <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Needs Attention</h3>
                <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">{needsAttention.length} items need action</p>
              </div>
            </div>
          </div>
          {needsAttention.length > 0 ? (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {needsAttention.map((item) => (
                <div key={item.key} className="flex items-center gap-3.5 px-4 py-3 rounded-2xl border border-red-100 bg-red-50/40 hover:border-red-300 hover:-translate-y-px transition-all duration-200">
                  <span className={`w-11 h-11 rounded-2xl flex items-center justify-center text-[13px] font-bold text-white bg-gradient-to-br ${gradFor(item.title)} shadow-md shrink-0`}>
                    {initials(item.title)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-gray-900 truncate">{item.title}</p>
                    <p className="text-[12px] text-gray-500 font-medium truncate">{item.meta}</p>
                  </div>
                  {item.kind === 'task'
                    ? <Badge tone="red">Overdue</Badge>
                    : <Badge tone="amber">Urgent</Badge>}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <span className="w-16 h-16 rounded-3xl bg-gradient-to-br from-green-100 to-emerald-200 flex items-center justify-center text-3xl mb-4 shadow-inner">🎉</span>
              <p className="text-[15px] font-bold text-gray-800">All clear!</p>
              <p className="text-[12.5px] text-gray-500 font-medium mt-1 max-w-[240px]">
                No overdue tasks or urgent tickets right now.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
