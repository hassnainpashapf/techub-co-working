'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Badge, Spinner, ErrorBanner } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';
import { useChartWidth } from '../../../components/charts';
import OverviewHero from '../../../components/OverviewHero';

// ---------- Rich stat card ----------
function RichStatCard({ label, value, sub, icon, grad, topBorder }) {
  return (
    <div className={`group relative overflow-hidden rounded-2xl bg-white border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 hover:shadow-[0_14px_34px_-12px_rgba(15,118,110,0.28)] hover:-translate-y-1 hover:border-teal-200 transition-all duration-300`}>
      <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${topBorder}`} />
      <div className="flex items-start justify-between mb-3">
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

// ---------- Full-width gradient area trend chart ----------
function AreaTrendChart({ labels, values, height = 280 }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 34, padT = 16, padX = 12;
  const max = Math.max(...values.map(Number), 1);
  const n = labels.length;
  const px = (i) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2));
  const py = (v) => H - padB - (Number(v) / max) * (H - padB - padT);
  const line = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${px(0).toFixed(1)},${(H - padB).toFixed(1)} ${line} ${px(n - 1).toFixed(1)},${(H - padB).toFixed(1)}`;
  const grid = [0.25, 0.5, 0.75, 1];
  const gradId = 'team-area-grad';
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.32" />
            <stop offset="60%" stopColor="#0f766e" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="team-line-grad" x1="0" y1="0" x2="1" y2="0">
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
        <polygon points={area} fill={`url(#${gradId})`} />
        <polyline points={line} fill="none" stroke="url(#team-line-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((v, i) => (
          <g key={i}>
            <circle cx={px(i)} cy={py(v)} r="7" fill="#0f766e" opacity="0.12" />
            <circle cx={px(i)} cy={py(v)} r="4" fill="#fff" stroke="#0f766e" strokeWidth="2.5">
              <title>{labels[i]}: {Number(v)} present</title>
            </circle>
          </g>
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
function SegmentDonut({ data, size = 190 }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const palette = ['#0f766e', '#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#9ca3af', '#14b8a6'];
  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
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
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em]">Members</span>
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

const PRESENT = ['present', 'late', 'half_day'];

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function fmtTime(v) {
  if (!v) return '—';
  const s = String(v);
  const m = s.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : s.slice(0, 5);
}

function statusBadge(status) {
  const s = String(status).toLowerCase();
  if (s === 'late') return <Badge tone="amber">Late</Badge>;
  if (s === 'on_leave' || s === 'leave') return <Badge tone="blue">On leave</Badge>;
  if (s === 'absent') return <Badge tone="red">Absent</Badge>;
  if (s === 'half_day') return <Badge tone="violet">Half day</Badge>;
  return <Badge tone="green">Present</Badge>;
}

export default function TeamOverviewPage() {
  const { allowed } = useRequireRoles('ceo', 'admin');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]); // staff-attendance rows, last 14 days
  const [leaves, setLeaves] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 13);
        const [u, att, lv] = await Promise.all([
          api.get('/users').catch(() => ({ users: [] })),
          api.get(`/staff-attendance?from=${dayKey(from)}&to=${dayKey(to)}`).catch(() => ({ attendance: [] })),
          api.get('/attendance/leaves').catch(() => ({ leaves: [] })),
        ]);
        if (!cancelled) {
          setUsers(u.users || u || []);
          setRows(att.attendance || att || []);
          setLeaves(lv.leaves || lv || []);
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
  const todayRows = rows.filter((r) => String(r.date).slice(0, 10) === today);
  const presentToday = todayRows.filter((r) => PRESENT.includes(r.status)).length;

  const approvedLeaves = leaves.filter((l) => String(l.status).toLowerCase() === 'approved');
  const onLeaveTodayList = approvedLeaves.filter((l) => {
    const f = l.from ? String(l.from).slice(0, 10) : '';
    const t = l.to ? String(l.to).slice(0, 10) : f;
    return f && f <= today && today <= t;
  });
  const onLeaveToday = onLeaveTodayList.length;

  const presentCount = rows.filter((r) => PRESENT.includes(r.status)).length;
  const avgAttendance = rows.length ? Math.round((presentCount / rows.length) * 100) : 0;

  // Attendance trend — last 14 days (present count per day)
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const byDay = {};
  rows.forEach((r) => {
    const k = String(r.date).slice(0, 10);
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(r);
  });
  const trendLabels = days.map((d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  const trendValues = days.map((d) => {
    const k = dayKey(d);
    return (byDay[k] || []).filter((r) => PRESENT.includes(r.status)).length;
  });

  // Role distribution
  const roleCounts = {};
  users.forEach((u) => {
    const r = (u.role || 'member').toLowerCase();
    roleCounts[r] = (roleCounts[r] || 0) + 1;
  });
  const roleData = Object.entries(roleCounts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // Who's in today — attendance rows + people on approved leave
  const usersById = {};
  users.forEach((u) => { if (u.id) usersById[String(u.id)] = u; });
  const nameOf = (r) =>
    r.employee?.name || r.employeeName || r.name ||
    usersById[String(r.employeeId || r.employee?.id || r.userId)]?.name || '—';
  const leaveNameOf = (l) =>
    l.employee?.name || l.employeeName || l.name ||
    usersById[String(l.employeeId || l.employee?.id || l.userId)]?.name || '—';

  const inToday = todayRows.map((r) => ({
    key: `a-${r.id || r.employeeId || Math.random()}`,
    name: nameOf(r),
    time: fmtTime(r.checkIn || r.checkInTime || r.time || r.startTime),
    status: r.status,
  }));
  onLeaveTodayList.forEach((l, i) => {
    inToday.push({
      key: `l-${l.id || i}`,
      name: leaveNameOf(l),
      time: '—',
      status: 'on_leave',
    });
  });

  return (
    <div className="pb-4">
      <OverviewHero
        title="Team Overview"
        sub="Team performance at a glance"
        chips={[
            { label: 'Present today', value: `${presentToday} / ${users.length}`, dot: '#34d399' },
            { label: 'Avg attendance', value: `${avgAttendance}%`, dot: '#fbbf24' },
            { label: 'On leave', value: String(onLeaveToday), dot: '#93c5fd' },
          ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 4xl:gap-3 mb-3 4xl:mb-3">
        <RichStatCard
          label="Total Team Members" value={users.length} sub="registered staff"
          icon="👥" grad="from-teal-500 to-emerald-600" topBorder="from-teal-500 to-emerald-400"
        />
        <RichStatCard
          label="Present Today" value={presentToday} sub={`${todayRows.length} records today`}
          icon="✅" grad="from-green-500 to-emerald-600" topBorder="from-green-500 to-emerald-400"
        />
        <RichStatCard
          label="On Leave" value={onLeaveToday} sub="approved leaves today"
          icon="🌴" grad="from-amber-500 to-orange-600" topBorder="from-amber-500 to-orange-400"
        />
        <RichStatCard
          label="Avg Attendance" value={`${avgAttendance}%`} sub="last 14 days"
          icon="📊" grad="from-blue-500 to-indigo-600" topBorder="from-blue-500 to-indigo-400"
        />
      </div>

      <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5 mb-3 4xl:mb-3">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3.5">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/25">📈</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Attendance Trend</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Present staff per day — last 14 days</p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 text-[12px] font-bold text-teal-700">
            <span className="w-2 h-2 rounded-full bg-teal-600" /> {presentCount} check-ins total
          </span>
        </div>
        <AreaTrendChart labels={trendLabels} values={trendValues} height={280} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 4xl:gap-3">
        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5">
          <div className="flex items-center gap-3.5 mb-3">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">🍩</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Role Distribution</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Team composition by role</p>
            </div>
          </div>
          <SegmentDonut data={roleData} size={190} />
        </div>

        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3.5">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">🟢</span>
              <div>
                <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Who&apos;s In Today</h3>
                <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">{inToday.length} {inToday.length === 1 ? 'record' : 'records'} today</p>
              </div>
            </div>
          </div>
          {inToday.length > 0 ? (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {inToday.map((p) => (
                <div key={p.key} className="flex items-center gap-3.5 px-4 py-3 rounded-2xl border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 hover:-translate-y-px transition-all duration-200">
                  <span className={`w-11 h-11 rounded-2xl flex items-center justify-center text-[13px] font-bold text-white bg-gradient-to-br ${gradFor(p.name)} shadow-md shrink-0`}>
                    {initials(p.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-gray-900 truncate">{p.name}</p>
                    <p className="text-[12px] text-gray-500 font-medium">
                      {String(p.status).toLowerCase() === 'on_leave' ? 'On approved leave' : `Checked in ${p.time}`}
                    </p>
                  </div>
                  {statusBadge(p.status)}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <span className="w-16 h-16 rounded-3xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-3xl mb-3 shadow-inner">🌙</span>
              <p className="text-[15px] font-bold text-gray-800">Nobody checked in yet</p>
              <p className="text-[12.5px] text-gray-500 font-medium mt-1 max-w-[240px]">
                Today&apos;s attendance will appear here once the team checks in.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
