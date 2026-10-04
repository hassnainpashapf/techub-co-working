'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';
import { useChartWidth } from '../../../../components/charts';

// ---------- Premium gradient hero banner ----------
function HeroBanner({ revenueMTD, outstanding, collection }) {
  const todayStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const chips = [
    { label: 'Revenue MTD', value: `Rs ${fmtNum(revenueMTD)}`, dot: '#34d399' },
    { label: 'Outstanding', value: `Rs ${fmtNum(outstanding)}`, dot: '#fbbf24' },
    { label: 'Collection', value: `${collection}%`, dot: '#93c5fd' },
  ];
  return (
    <div className="relative overflow-hidden rounded-3xl mb-6 4xl:mb-8 shadow-[0_12px_40px_-12px_rgba(13,92,86,0.55)]">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0f766e] via-[#0c5a54] to-[#08312d]" />
      {/* decorative glows */}
      <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-teal-300/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-emerald-400/15 blur-3xl pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '22px 22px' }} />
      <div className="relative px-7 py-8 4xl:px-10 4xl:py-10">
        <p className="text-[12px] 4xl:text-[13px] font-semibold uppercase tracking-[0.2em] text-teal-200/80 mb-2">{todayStr}</p>
        <h1 className="text-[30px] 4xl:text-[40px] font-bold text-white tracking-tight leading-tight">Investor Overview</h1>
        <p className="text-[14px] 4xl:text-[16px] text-teal-100/85 mt-1.5 font-medium">Financial performance at a glance</p>
        <div className="flex flex-wrap gap-3 mt-6">
          {chips.map((c) => (
            <div key={c.label} className="flex items-center gap-2.5 pl-4 pr-5 py-2.5 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
              <span className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_currentColor]" style={{ background: c.dot, color: c.dot }} />
              <span className="text-[12.5px] 4xl:text-[13.5px] text-teal-100/80 font-medium">{c.label}</span>
              <span className="text-[15px] 4xl:text-[17px] font-bold text-white">{c.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
      <p className="text-[30px] 4xl:text-[38px] font-bold text-gray-900 tracking-tight leading-none">{value}</p>
      {sub && <p className="text-[12.5px] text-gray-500 font-medium mt-2">{sub}</p>}
    </div>
  );
}

// ---------- Two-series revenue vs expenses area chart ----------
function DualTrendChart({ labels, revenue, expenses, height = 280 }) {
  const [ref, W] = useChartWidth();
  const H = height;
  const padB = 34, padT = 16, padX = 12;
  const max = Math.max(...revenue.map(Number), ...expenses.map(Number), 1);
  const n = labels.length;
  const px = (i) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2));
  const py = (v) => H - padB - (Number(v) / max) * (H - padB - padT);
  const lineOf = (vals) => vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const areaOf = (vals) => `${px(0).toFixed(1)},${(H - padB).toFixed(1)} ${lineOf(vals)} ${px(n - 1).toFixed(1)},${(H - padB).toFixed(1)}`;
  const grid = [0.25, 0.5, 0.75, 1];
  return (
    <div ref={ref} className="relative w-full" style={{ height: H }}>
      <svg width={W} height={H} className="block">
        <defs>
          <linearGradient id="inv-rev-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="inv-exp-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((f) => {
          const y = Math.round(H - padB - f * (H - padB - padT));
          return (
            <g key={f}>
              <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="rgba(15,118,110,0.10)" strokeWidth="1" strokeDasharray="4 4" />
              <text x={W - padX} y={y - 5} textAnchor="end" fill="rgba(0,0,0,0.35)" fontSize="11" fontWeight="600">{fmtNum(Math.round(f * max))}</text>
            </g>
          );
        })}
        <polygon points={areaOf(expenses)} fill="url(#inv-exp-grad)" />
        <polygon points={areaOf(revenue)} fill="url(#inv-rev-grad)" />
        <polyline points={lineOf(expenses)} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" />
        <polyline points={lineOf(revenue)} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {revenue.map((v, i) => (
          <g key={i}>
            <circle cx={px(i)} cy={py(v)} r="7" fill="#0f766e" opacity="0.12" />
            <circle cx={px(i)} cy={py(v)} r="4" fill="#fff" stroke="#0f766e" strokeWidth="2.5">
              <title>{labels[i]} — Revenue Rs {fmtNum(v)}, Expenses Rs {fmtNum(expenses[i])}</title>
            </circle>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={i} x={px(i)} y={H - 12} textAnchor="middle" fill="rgba(0,0,0,0.5)" fontSize="11" fontWeight="600">
            {String(l).slice(0, 8)}
          </text>
        ))}
      </svg>
      <div className="absolute top-1 left-1 flex items-center gap-4 text-[12px] font-bold">
        <span className="flex items-center gap-1.5 text-teal-700"><span className="w-3 h-[3px] rounded bg-teal-600" /> Revenue</span>
        <span className="flex items-center gap-1.5 text-amber-600"><span className="w-3 h-[3px] rounded bg-amber-500" /> Expenses</span>
      </div>
    </div>
  );
}

// ---------- Rich multi-segment donut ----------
function SegmentDonut({ data, size = 190, centerLabel = 'Total' }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const palette = ['#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'];
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
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
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <span className="text-[20px] font-bold text-gray-900 tracking-tight leading-tight">Rs {fmtNum(total)}</span>
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] mt-1">{centerLabel}</span>
        </div>
      </div>
      <div className="w-full sm:flex-1 space-y-1 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors">
            <span className="w-3.5 h-3.5 rounded-[5px] shrink-0 shadow-sm" style={{ background: palette[i % palette.length] }} />
            <span className="text-[13.5px] text-gray-700 font-medium capitalize truncate">{d.label}</span>
            <span className="text-[11px] font-semibold text-gray-400 ml-auto">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            <span className="text-[13px] font-bold text-gray-900 whitespace-nowrap">Rs {fmtNum(d.value)}</span>
          </div>
        ))}
        {data.length === 0 && <span className="text-sm text-gray-500">No data</span>}
      </div>
    </div>
  );
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function money(n) {
  return `Rs ${fmtNum(n)}`;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(d) {
  return d.toLocaleDateString('en-GB', { month: 'short' });
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export default function InvestorOverviewPage() {
  const { allowed } = useRequireRoles('ceo', 'admin');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pnl, setPnl] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [trendMonths, setTrendMonths] = useState([]); // [{label, revenue, expenses}]

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const now = new Date();
        const thisMonth = monthKey(now);
        const monthList = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthList.push(d);
        }
        const [p, inv, ...pnls] = await Promise.all([
          api.get(`/finance/pnl?month=${thisMonth}`).catch(() => ({})),
          api.get('/billing/invoices').catch(() => ({ invoices: [] })),
          ...monthList.map((d) => api.get(`/finance/pnl?month=${monthKey(d)}`).catch(() => ({}))),
        ]);
        if (!cancelled) {
          const p0 = p.pnl || p || {};
          setPnl(p0);
          setInvoices(inv.invoices || inv || []);
          setTrendMonths(monthList.map((d, i) => {
            const q = pnls[i]?.pnl || pnls[i] || {};
            return {
              label: monthLabel(d),
              revenue: Number(q.income ?? q.totalIncome ?? 0),
              expenses: Number(q.expenses ?? q.totalExpenses ?? 0),
            };
          }));
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

  const revenueMTD = Number(pnl?.income ?? pnl?.totalIncome ?? 0);
  const expensesMTD = Number(pnl?.expenses ?? pnl?.totalExpenses ?? 0);
  const netMTD = Number(pnl?.net ?? pnl?.profit ?? (revenueMTD - expensesMTD));

  const live = invoices.filter((r) => String(r.status || '').toLowerCase() !== 'cancelled');
  const balanceOf = (r) => Number(r.balance ?? r.amount ?? 0);
  const statusOf = (r) => String(r.status || 'unpaid').toLowerCase();

  const paidAmt = live.filter((r) => statusOf(r) === 'paid').reduce((s, r) => s + balanceOf(r), 0);
  // Outstanding = unpaid + overdue balances
  const outstandingList = live
    .filter((r) => statusOf(r) !== 'paid')
    .map((r) => ({ ...r, due: balanceOf(r) }));
  const outstanding = outstandingList.reduce((s, r) => s + r.due, 0);
  const totalBilled = live.reduce((s, r) => s + balanceOf(r), 0);
  const collection = totalBilled > 0 ? Math.round((paidAmt / totalBilled) * 100) : 0;

  const donutData = [
    { label: 'Paid', value: paidAmt },
    { label: 'Unpaid', value: live.filter((r) => statusOf(r) === 'unpaid').reduce((s, r) => s + balanceOf(r), 0) },
    { label: 'Overdue', value: live.filter((r) => statusOf(r) === 'overdue').reduce((s, r) => s + balanceOf(r), 0) },
  ].filter((d) => d.value > 0);

  const topDues = [...outstandingList].sort((a, b) => b.due - a.due).slice(0, 5);

  const trendLabels = trendMonths.map((m) => m.label);
  const trendRevenue = trendMonths.map((m) => m.revenue);
  const trendExpenses = trendMonths.map((m) => m.expenses);

  return (
    <div className="pb-4">
      <HeroBanner revenueMTD={revenueMTD} outstanding={outstanding} collection={collection} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 4xl:gap-6 mb-6 4xl:mb-8">
        <RichStatCard
          label="Revenue" value={money(revenueMTD)} sub="this month"
          icon="💰" grad="from-teal-500 to-emerald-600" topBorder="from-teal-500 to-emerald-400"
        />
        <RichStatCard
          label="Outstanding Dues" value={money(outstanding)} sub={`${outstandingList.length} unpaid invoices`}
          icon="⏳" grad="from-amber-500 to-orange-600" topBorder="from-amber-500 to-orange-400"
        />
        <RichStatCard
          label="Expenses" value={money(expensesMTD)} sub="this month"
          icon="🧾" grad="from-rose-500 to-pink-600" topBorder="from-rose-500 to-pink-400"
        />
        <RichStatCard
          label="Net Profit" value={money(netMTD)} sub="revenue − expenses, this month"
          icon="📈" grad="from-blue-500 to-indigo-600" topBorder="from-blue-500 to-indigo-400"
        />
      </div>

      <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-8 mb-6 4xl:mb-8">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3.5">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/25">💹</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Revenue vs Expenses</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Last 6 months</p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 border border-teal-100 text-[12px] font-bold text-teal-700">
            Net 6 mo: Rs {fmtNum(trendRevenue.reduce((s, v) => s + v, 0) - trendExpenses.reduce((s, v) => s + v, 0))}
          </span>
        </div>
        <DualTrendChart labels={trendLabels} revenue={trendRevenue} expenses={trendExpenses} height={280} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 4xl:gap-6">
        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-8">
          <div className="flex items-center gap-3.5 mb-6">
            <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">🍩</span>
            <div>
              <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Invoice Status</h3>
              <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Billed amounts by status</p>
            </div>
          </div>
          <SegmentDonut data={donutData} size={190} centerLabel="Billed" />
        </div>

        <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 4xl:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3.5">
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl text-white bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/25">⏳</span>
              <div>
                <h3 className="text-[17px] 4xl:text-[20px] font-bold text-gray-900 tracking-tight">Top Pending Dues</h3>
                <p className="text-[12.5px] text-gray-500 font-medium mt-0.5">Largest unpaid invoices</p>
              </div>
            </div>
          </div>
          {topDues.length > 0 ? (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {topDues.map((r) => {
                const st = statusOf(r);
                const name = r.memberName || r.member?.name || '—';
                return (
                  <div key={r.id || r.number} className="flex items-center gap-3.5 px-4 py-3 rounded-2xl border border-gray-100 hover:border-amber-200 hover:bg-amber-50/40 hover:-translate-y-px transition-all duration-200">
                    <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-[13px] font-bold text-white bg-gradient-to-br from-amber-500 to-orange-600 shadow-md shrink-0">
                      {initials(name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold text-gray-900 truncate">
                        {r.number || String(r.id || '').slice(0, 8)} · {name}
                      </p>
                      <p className="text-[12px] text-gray-500 font-medium">
                        Due {r.dueDate ? String(r.dueDate).slice(0, 10) : '—'}
                      </p>
                    </div>
                    <span className="text-[14px] font-bold text-gray-900 whitespace-nowrap">{money(r.due)}</span>
                    <Badge tone={st === 'overdue' ? 'red' : 'amber'}>{st === 'overdue' ? 'Overdue' : 'Unpaid'}</Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <span className="w-16 h-16 rounded-3xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center text-3xl mb-4 shadow-inner">🎉</span>
              <p className="text-[15px] font-bold text-gray-800">All clear — no pending dues</p>
              <p className="text-[12.5px] text-gray-500 font-medium mt-1 max-w-[240px]">
                Every invoice is paid. Nothing outstanding right now.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
