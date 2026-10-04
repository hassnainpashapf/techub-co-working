'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  StatCard,
  DataTable,
  Badge,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';
import { HDMultiLineChart, HDBarChart } from '../../../components/charts';

function ChartCard({ title, sub, children, icon }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-gray-200 p-5 hover:border-[#0f766e]/35 transition-all duration-200">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {icon && <span className="icon-tile w-9 h-9 text-base">{icon}</span>}
          <div>
            <h3 className="text-[15px] font-bold text-gray-900">{title}</h3>
            {sub && <p className="text-[12px] text-gray-900/55 font-medium mt-0.5">{sub}</p>}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

// Multi-segment donut with legend (same style as dashboard)
function SegmentDonut({ data, size = 160 }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const palette = ['#0f766e', '#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#9ca3af'];
  return (
    <div className="flex items-center gap-5">
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
      <div className="space-y-2 min-w-0 flex-1">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
            <span className="text-gray-600 capitalize truncate">{String(d.label).replace(/_/g, ' ')}</span>
            <span className="font-bold text-gray-900 ml-auto pl-2">{d.value}</span>
          </div>
        ))}
        {data.length === 0 && <span className="text-sm text-gray-500">No data</span>}
      </div>
    </div>
  );
}

const PRESENT = ['present', 'late', 'half_day'];

function dayKey(d) {
  return d.toISOString().slice(0, 10);
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

  const onLeaveToday = leaves.filter((l) => {
    if (String(l.status).toLowerCase() !== 'approved') return false;
    const f = l.from ? String(l.from).slice(0, 10) : '';
    const t = l.to ? String(l.to).slice(0, 10) : f;
    return f <= today && today <= t;
  }).length;

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

  // Attendance by weekday
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const wdCounts = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach((r) => {
    if (!PRESENT.includes(r.status)) return;
    const d = new Date(String(r.date).slice(0, 10) + 'T12:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0
    wdCounts[dow]++;
  });
  const weekdayData = weekdays.map((label, i) => ({ label, value: wdCounts[i] }));

  // Top punctual members
  const perEmp = {};
  rows.forEach((r) => {
    const id = r.employeeId || r.employee?.id || 'unknown';
    if (!perEmp[id]) perEmp[id] = { name: r.employee?.name || '—', present: 0, late: 0, absent: 0 };
    if (r.status === 'late') { perEmp[id].late++; perEmp[id].present++; }
    else if (r.status === 'present' || r.status === 'half_day') perEmp[id].present++;
    else if (r.status === 'absent') perEmp[id].absent++;
  });
  const punctual = Object.values(perEmp)
    .sort((a, b) => b.present - a.present || a.late - b.late)
    .slice(0, 8);

  return (
    <div>
      <PageHeader title="Team Overview" sub="Team performance at a glance" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 4xl:gap-6 mb-6 4xl:mb-8">
        <StatCard label="Total Team Members" value={users.length} sub="registered staff" accent="teal" />
        <StatCard label="Present Today" value={presentToday} sub={`${todayRows.length} records today`} accent="green" />
        <StatCard label="On Leave" value={onLeaveToday} sub="approved leaves today" accent="amber" />
        <StatCard label="Avg Attendance" value={`${avgAttendance}%`} sub="last 14 days" accent="indigo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 4xl:gap-6 mb-6 4xl:mb-8">
        <div className="lg:col-span-2">
          <ChartCard title="Attendance Trend" sub="Present staff per day — last 14 days" icon="📈">
            <HDMultiLineChart
              labels={trendLabels}
              series={[{ name: 'Present', values: trendValues, color: '#0f766e' }]}
              height={220}
            />
          </ChartCard>
        </div>
        <ChartCard title="Role Distribution" sub="Team by role" icon="👥">
          <div className="py-2">
            <SegmentDonut data={roleData} />
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 4xl:gap-6 mb-6 4xl:mb-8">
        <ChartCard title="Attendance by Weekday" sub="Present check-ins per weekday" icon="📊">
          <HDBarChart data={weekdayData} height={200} />
        </ChartCard>
        <div className="rounded-2xl bg-white border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="icon-tile w-9 h-9 text-base">🏆</span>
            <div>
              <h3 className="text-[15px] font-bold text-gray-900">Top Punctual Members</h3>
              <p className="text-[12px] text-gray-900/55 font-medium mt-0.5">Most present days — last 14 days</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: 'name', label: 'Member', render: (r) => <span className="font-medium text-gray-900">{r.name}</span> },
              { key: 'present', label: 'Present', render: (r) => <Badge tone="green">{r.present} days</Badge> },
              { key: 'late', label: 'Late', render: (r) => r.late > 0 ? <Badge tone="amber">{r.late}</Badge> : <span className="text-gray-400">0</span> },
              { key: 'absent', label: 'Absent', render: (r) => r.absent > 0 ? <Badge tone="red">{r.absent}</Badge> : <span className="text-gray-400">0</span> },
            ]}
            rows={punctual}
            empty={{ title: 'No attendance data', hint: 'Check in to start tracking.' }}
          />
        </div>
      </div>
    </div>
  );
}
