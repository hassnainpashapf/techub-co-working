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

// ---------- Full-width gradient area trend chart ----------
function AreaTrendChart({ labels, values, height = 280, tooltipWord = 'new members' }) {
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
  const gradId = 'school-area-grad';
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.32" />
            <stop offset="60%" stopColor="#0f766e" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="school-line-grad" x1="0" y1="0" x2="1" y2="0">
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
        <polyline points={line} fill="none" stroke="url(#school-line-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {values.map((v, i) => (
          <g key={i}>
            <circle cx={px(i)} cy={py(v)} r="7" fill="#0f766e" opacity="0.12" />
            <circle cx={px(i)} cy={py(v)} r="4" fill="#fff" stroke="#0f766e" strokeWidth="2.5">
              <title>{labels[i]}: {Number(v)} {tooltipWord}</title>
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

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SchoolOverviewPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'receptionist');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [m, l, c, co] = await Promise.all([
          api.get('/members').catch(() => ({ members: [] })),
          api.get('/leads').catch(() => ({ leads: [] })),
          api.get('/contracts?limit=100').catch(() => ({ contracts: [] })),
          api.get('/companies').catch(() => ({ companies: [] })),
        ]);
        if (!cancelled) {
          setMembers(m.members || m || []);
          setLeads(l.leads || l || []);
          setContracts(c.contracts || c || []);
          setCompanies(co.companies || co || []);
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

  const now = new Date();
  const thisMonthKey = monthKey(now);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const activeContracts = contracts.filter(
    (c) => String(c.status || '').toLowerCase() === 'active'
  ).length;

  const newLeadsMonth = leads.filter(
    (l) => l.createdAt && monthKey(new Date(l.createdAt)) === thisMonthKey
  ).length;

  const newLeads30d = leads.filter((l) => {
    if (!l.createdAt) return false;
    return new Date(l.createdAt) >= thirtyDaysAgo;
  }).length;

  // Member growth — new members per month, last 6 months
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d);
  }
  const growthLabels = months.map((d) => d.toLocaleDateString('en-GB', { month: 'short' }));
  const growthValues = months.map((d) => {
    const k = monthKey(d);
    return members.filter((m) => m.createdAt && monthKey(new Date(m.createdAt)) === k).length;
  });

  // Membership plan distribution
  const planCounts = {};
  members.forEach((m) => {
    const p = m.planName || m.plan?.name || m.membershipPlanName || m.membershipPlan || m.plan;
    if (!p) return;
    const key = String(p).toLowerCase();
    planCounts[key] = (planCounts[key] || 0) + 1;
  });
  const planData = Object.entries(planCounts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // Recent members — latest 5 by createdAt
  const recentMembers = [...members]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5);

  return (
    <div className="pb-4">
      <OverviewHero
        title="School Overview"
        sub="Member community at a glance"
        chips={[
            { label: 'Total members', value: String(members.length), dot: '#34d399' },
            { label: 'Active contracts', value: String(activeContracts), dot: '#fbbf24' },
            { label: 'New leads this month', value: String(newLeadsMonth), dot: '#93c5fd' },
          ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 4xl:gap-4 mb-4 4xl:mb-5">
        <RichStatCard
          label="Total Members" value={members.length} sub="registered members"
          icon="🎓" grad="from-teal-500 to-emerald-600" topBorder="from-teal-500 to-emerald-400"
        />
        <RichStatCard
          label="Active Contracts" value={activeContracts} sub={`${contracts.length} contracts total`}
          icon="📝" grad="from-green-500 to-emerald-600" topBorder="from-green-500 to-emerald-400"
        />
        <RichStatCard
          label="Companies" value={companies.length} sub="member companies"
          icon="🏢" grad="from-amber-500 to-orange-600" topBorder="from-amber-500 to-orange-400"
        />
        <RichStatCard
          label="New Leads" value={newLeads30d} sub="last 30 days"
          icon="🎯" grad="from-blue-500 to-indigo-600" topBorder="from-blue-500 to-indigo-400"
        />
      </div>

      <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5 mb-4 4xl:mb-5">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3.5">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/25">📈</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Member Growth</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">New members per month — last 6 months</p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 text-[12px] font-bold text-teal-700">
            <span className="w-2 h-2 rounded-full bg-teal-600" /> {growthValues.reduce((s, v) => s + v, 0)} joined in 6 months
          </span>
        </div>
        <AreaTrendChart labels={growthLabels} values={growthValues} height={280} tooltipWord="new members" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 4xl:gap-4">
        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5">
          <div className="flex items-center gap-3.5 mb-4">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">🍩</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Plan Distribution</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Members by membership plan</p>
            </div>
          </div>
          <SegmentDonut data={planData} size={190} />
        </div>

        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3.5">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">🆕</span>
              <div>
                <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Recent Members</h3>
                <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Latest {recentMembers.length} joins</p>
              </div>
            </div>
          </div>
          {recentMembers.length > 0 ? (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {recentMembers.map((m) => (
                <div key={m.id || m.name} className="flex items-center gap-3.5 px-4 py-3 rounded-2xl border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 hover:-translate-y-px transition-all duration-200">
                  <span className={`w-11 h-11 rounded-2xl flex items-center justify-center text-[13px] font-bold text-white bg-gradient-to-br ${gradFor(m.name)} shadow-md shrink-0`}>
                    {initials(m.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-gray-900 truncate">{m.name || '—'}</p>
                    <p className="text-[12px] text-gray-500 font-medium truncate">
                      {m.companyName ? `${m.companyName} · ` : ''}Joined {fmtDate(m.createdAt)}
                    </p>
                  </div>
                  <Badge tone={String(m.status || '').toLowerCase() === 'active' ? 'green' : 'slate'}>
                    {m.status || '—'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <span className="w-16 h-16 rounded-3xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-3xl mb-4 shadow-inner">🎓</span>
              <p className="text-[15px] font-bold text-gray-800">No members yet</p>
              <p className="text-[12.5px] text-gray-500 font-medium mt-1 max-w-[240px]">
                New member joins will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
