'use client';

// Phase 41 Track 10: Procurement Dashboard — stats, spend trend, approval inbox, alerts.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-PK');

function SpendChart({ data }) {
  if (!data || !data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.spend));
  const w = 640, h = 220, pad = 36;
  const bw = (w - pad * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad} x2={w - 12} y1={h - pad - f * (h - pad * 2)} y2={h - pad - f * (h - pad * 2)}
          stroke="rgba(148,163,184,.15)" strokeDasharray="4 4" />
      ))}
      {data.map((d, i) => {
        const bh = (d.spend / max) * (h - pad * 2);
        const x = pad + i * bw + bw * 0.2;
        return (
          <g key={i}>
            <rect x={x} y={h - pad - bh} width={bw * 0.6} height={bh} rx={6}
              fill="url(#spendGrad)" opacity={d.spend ? 1 : 0.25} />
            <text x={x + bw * 0.3} y={h - pad + 16} textAnchor="middle" fontSize={11} fill="#94a3b8">
              {d.month.split(' ')[0]}
            </text>
            {d.spend > 0 && (
              <text x={x + bw * 0.3} y={h - pad - bh - 6} textAnchor="middle" fontSize={10} fill="#e2e8f0">
                {Math.round(d.spend / 1000)}k
              </text>
            )}
          </g>
        );
      })}
      <defs>
        <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function ProcurementDashboardPage() {
  const [stats, setStats] = useState(null);
  const [modules, setModules] = useState({});
  const [trend, setTrend] = useState([]);
  const [top, setTop] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [s, t, v] = await Promise.all([
        api.get('/procurement/stats'),
        api.get('/procurement/spend-trend?months=6'),
        api.get('/procurement/top-vendors?limit=5'),
      ]);
      setStats(s.stats || null);
      setModules(s.modules || {});
      setTrend(t.months || []);
      setTop(v.vendors || []);
    } catch (e) {
      setError(e.message || 'Dashboard load nahi ho saka');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-6"><Spinner /></div>;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Procurement Dashboard" sub="Purchases, bills aur vendor spend ka overview"
        actions={<button onClick={load} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">↻ Refresh</button>} />
      {error && <ErrorBanner message={error} onRetry={load} />}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard label="Open POs" value={stats.openPOs} accent="blue" />
          <StatCard label="Meri Approvals" value={stats.pendingApprovals} accent={stats.pendingApprovals ? 'amber' : 'green'} />
          <StatCard label="Overdue Bills" value={stats.overdueBills} accent={stats.overdueBills ? 'red' : 'green'} />
          <StatCard label="Expiring Contracts" value={stats.expiringContracts} accent={stats.expiringContracts ? 'amber' : 'green'} sub="30 din me" />
          <StatCard label="Low Stock" value={stats.lowStock} accent={stats.lowStock ? 'amber' : 'green'} />
          <StatCard label="Is Mahine ka Spend" value={fmt(stats.monthSpend)} accent="purple" />
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
          <h3 className="text-white font-semibold mb-3">📈 Vendor Spend Trend (6 mahine)</h3>
          {trend.length ? <SpendChart data={trend} /> : <EmptyState title="Data nahi" hint="Paid vendor bills par trend banega" />}
        </div>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
          <h3 className="text-white font-semibold mb-3">🏆 Top Vendors (spend-wise)</h3>
          {top.length ? (
            <div className="space-y-2">
              {top.map((v, i) => (
                <div key={v.vendorId} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▫️'}</span>
                    <span className="text-slate-200 font-medium">{v.name}</span>
                  </div>
                  <span className="text-slate-100 font-semibold">{fmt(v.totalSpend)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Koi paid bill nahi" hint="Vendor payments hone par top vendors yahan aayenge" />}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
          <h3 className="text-white font-semibold mb-3">✍️ Approval Inbox {stats && stats.inbox.length > 0 && <Badge tone="amber">{stats.inbox.length}</Badge>}</h3>
          {stats && stats.inbox.length ? (
            <div className="space-y-2">
              {stats.inbox.map((po) => (
                <a key={po.id} href="/procurement/purchase-orders"
                  className="flex items-center justify-between rounded-xl bg-white/5 hover:bg-white/10 px-4 py-3 transition">
                  <div>
                    <div className="text-slate-100 font-semibold">{po.number} <span className="text-slate-400 font-normal">· {po.vendorName}</span></div>
                    <div className="text-xs text-slate-400">{po.requestedBy} ne request kiya · Level {po.level}</div>
                  </div>
                  <span className="text-slate-100 font-semibold">{fmt(po.total)}</span>
                </a>
              ))}
            </div>
          ) : <EmptyState title="Koi pending approval nahi" hint={modules.purchaseOrders === false ? 'Purchase Orders module abhi enable nahi' : 'Sab approvals clear hain 🎉'} />}
        </div>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
          <h3 className="text-white font-semibold mb-3">⚠️ Alerts</h3>
          {stats && stats.alerts.length ? (
            <div className="space-y-2">
              {stats.alerts.map((a, i) => (
                <div key={i} className={`rounded-xl px-4 py-3 text-sm ${a.severity === 'high' ? 'bg-red-500/10 border border-red-500/30 text-red-200' : 'bg-amber-500/10 border border-amber-500/30 text-amber-200'}`}>
                  {a.text}
                </div>
              ))}
            </div>
          ) : <EmptyState title="Koi alert nahi" hint="Overdue bills, expiring contracts ya low stock par yahan alert aayega" />}
        </div>
      </div>
    </div>
  );
}
