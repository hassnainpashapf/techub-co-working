'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, ErrorBanner, Spinner, EmptyState } from '../../../../components/ui';

const DEPT_COLORS = {
  ops: '#3b82f6', finance: '#22c55e', sales: '#f59e0b', admin: '#2dd4bf', support: '#ec4899',
};

function AttritionChart({ series }) {
  const max = Math.max(1, ...series.map((s) => Math.max(s.joins, s.exits)));
  const W = 640, H = 200, padL = 36, padB = 28;
  const bw = Math.min(28, (W - padL - 20) / series.length / 2.4);
  const step = (W - padL - 10) / series.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-52">
      {[0.25, 0.5, 0.75, 1].map((f) => {
        const y = H - padB - (H - padB - 12) * f;
        return (
          <g key={f}>
            <line x1={padL} y1={y} x2={W} y2={y} stroke="rgba(0,0,0,0.07)" />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">
              {Math.round(max * f)}
            </text>
          </g>
        );
      })}
      {series.map((s, i) => {
        const x = padL + i * step + (step - bw * 2 - 6) / 2;
        const h = (H - padB - 12);
        const jh = (s.joins / max) * h, eh = (s.exits / max) * h;
        return (
          <g key={i}>
            <rect x={x} y={H - padB - jh} width={bw} height={Math.max(2, jh)} rx="3" fill="#22c55e" opacity="0.85">
              <title>{s.month}: {s.joins} joins</title>
            </rect>
            <rect x={x + bw + 6} y={H - padB - eh} width={bw} height={Math.max(2, eh)} rx="3" fill="#ef4444" opacity="0.85">
              <title>{s.month}: {s.exits} exits</title>
            </rect>
            {series.length <= 12 && (
              <text x={x + bw + 3} y={H - 10} textAnchor="middle" fontSize="10" fill="#94a3b8" transform={`rotate(-0 ${x + bw + 3} ${H - 10})`}>
                {s.month}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ data, total }) {
  const R = 60, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = data.filter((d) => d.count > 0);
  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg viewBox="0 0 160 160" className="w-40 h-40">
        <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="22" />
        {segs.map((d, i) => {
          const frac = total ? d.count / total : 0;
          const dash = `${frac * C} ${C}`;
          const off = -acc * C;
          acc += frac;
          return (
            <circle key={i} cx="80" cy="80" r={R} fill="none" stroke={DEPT_COLORS[d.department] || '#64748b'}
              strokeWidth="22" strokeDasharray={dash} strokeDashoffset={off} transform="rotate(-90 80 80)" />
          );
        })}
        <text x="80" y="76" textAnchor="middle" fontSize="20" fill="#111827" fontWeight="800">{total}</text>
        <text x="80" y="96" textAnchor="middle" fontSize="10" fill="#94a3b8">employees</text>
      </svg>
      <div className="space-y-2">
        {segs.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full" style={{ background: DEPT_COLORS[d.department] || '#64748b' }} />
            <span className="text-gray-600 capitalize">{d.department}</span>
            <span className="text-gray-900 font-bold ml-auto pl-6">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const INBOX = [
  { key: 'leaves', label: 'Leave requests pending', path: '/hr/leaves', icon: '🏖️' },
  { key: 'advances', label: 'Salary advances pending', path: '/hr/advances', icon: '💰' },
  { key: 'onboarding', label: 'Onboardings in progress', path: '/hr/onboarding', icon: '🧭' },
  { key: 'exits', label: 'Exits in pipeline', path: '/hr/exits', icon: '🚪' },
];

export default function HrDashboardPage() {
  const [stats, setStats] = useState(null);
  const [attr, setAttr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([api.get('/hr/stats'), api.get('/hr/attrition?months=12')]);
        setStats(s); setAttr(a);
      } catch (e) { setError(e.message || 'Failed to load'); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-8"><Spinner /></div>;
  if (error) return <div className="p-8"><ErrorBanner message={error} onRetry={() => location.reload()} /></div>;
  if (!stats) return <div className="p-8"><EmptyState title="No data" hint="HR module not yet migrated" /></div>;

  const ta = stats.todayAttendance;
  const attTotal = ta.present + ta.late + ta.absent + ta.onLeave + ta.noRecord;
  const inboxItems = INBOX.filter((i) => stats.pending[i.key] > 0);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="HR Dashboard" sub="Headcount, attendance, approvals aur attrition — ek nazar me" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active employees" value={stats.headcount.active} accent="blue" icon="👥" />
        <StatCard label="On leave today" value={ta.onLeave} accent="amber" icon="🏖️" />
        <StatCard label="Present today" value={ta.present + ta.late} accent="green" icon="✅" />
        <StatCard label="Exited (all time)" value={stats.headcount.exited} accent="red" icon="🚪" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-gray-900 font-bold">Attrition — joins vs exits</h3>
            <div className="flex gap-3 text-xs text-gray-500">
              <span><span className="inline-block w-2.5 h-2.5 rounded bg-green-500 mr-1" />Joins</span>
              <span><span className="inline-block w-2.5 h-2.5 rounded bg-red-500 mr-1" />Exits</span>
            </div>
          </div>
          {attr && attr.series.length > 0 ? (
            <>
              <AttritionChart series={attr.series} />
              {!attr.exitsSupported && (
                <p className="text-xs text-amber-700 mt-2">⚠️ Exits tracking merge nahi hua — exits 0 dikh rahe hain</p>
              )}
            </>
          ) : <EmptyState title="No trend data" />}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-gray-900 font-bold mb-3">Department breakdown</h3>
          {stats.departments.length > 0 ? (
            <Donut data={stats.departments} total={stats.departments.reduce((a, d) => a + d.count, 0)} />
          ) : <EmptyState title="No departments" hint="Employees add hote hi yahan dikhenge" />}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-gray-900 font-bold mb-3">📥 Pending approvals inbox</h3>
          {inboxItems.length > 0 ? (
            <div className="space-y-2">
              {inboxItems.map((i) => (
                <Link key={i.key} href={i.path}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 hover:bg-gray-100 transition">
                  <span className="text-gray-800 text-sm">{i.icon} {i.label}</span>
                  <span className="text-xl font-extrabold text-amber-600">{stats.pending[i.key]}</span>
                </Link>
              ))}
            </div>
          ) : <EmptyState title="All clear 🎉" hint="Koi pending approval nahi" />}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-gray-900 font-bold">🕐 Aaj ki attendance</h3>
            <Link href="/hr/attendance" className="text-xs text-teal-700 hover:underline">Details →</Link>
          </div>
          {attTotal > 0 ? (
            <div className="space-y-3">
              {[
                ['Present', ta.present, '#22c55e'],
                ['Late', ta.late, '#f59e0b'],
                ['Absent', ta.absent, '#ef4444'],
                ['On leave', ta.onLeave, '#2dd4bf'],
                ['No record', ta.noRecord, '#64748b'],
              ].map(([label, n, color]) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-20">{label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${attTotal ? (n / attTotal) * 100 : 0}%`, background: color }} />
                  </div>
                  <span className="text-sm font-bold text-gray-900 w-8 text-right">{n}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No attendance yet" hint="Staff check-in karte hi yahan dikhega" />}
        </div>
      </div>
    </div>
  );
}
