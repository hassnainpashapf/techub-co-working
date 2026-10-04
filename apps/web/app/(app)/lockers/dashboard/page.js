'use client';

// Phase 56 Track 10/10: Locker Dashboard — StatCards, quick links, expiring rentals.
// Backend: /api/locker-dashboard (mount: app.use('/api/locker-dashboard', require('./routes/locker-dashboard'))).
// Sidebar link: { label: 'Lockers', path: '/lockers/dashboard' } — roles: ceo/admin/super_admin/manager.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const QUICK_LINKS = [
  { label: '🔐 Locker Inventory', href: '/lockers', desc: 'Rent/return actions' },
  { label: '🗺️ Locker Map', href: '/lockers/map', desc: 'Floor/zone view' },
  { label: '🧑 Member Portal', href: '/portal/lockers', desc: 'Member rentals view' },
];

export default function LockerDashboardPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        setLoading(true);
        const s = await api.get('/api/locker-dashboard/stats');
        setStats(s.data || {});
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;
  if (err) return <ErrorBanner message={err} />;

  const s = stats || {};
  const pendingModules = Object.entries(s.modules || {}).filter(([, v]) => !v).map(([k]) => k);
  const expiring = s.expiring7d || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader title="🔐 Locker Dashboard" subtitle="Occupancy, rentals, revenue aur expiring rentals" />

      {pendingModules.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          ⚠️ Kuch modules abhi live nahi: {pendingModules.join(', ')} — schema merge ke baad auto-live.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Total Lockers" value={s.total ?? 0} icon="🔐" accent="blue" />
        <StatCard label="Occupancy" value={s.occupancyPct != null ? `${s.occupancyPct}%` : '—'} icon="📊" accent="indigo" sub={`${s.occupied ?? 0} occupied · ${s.available ?? 0} available`} />
        <StatCard label="Active Rentals" value={s.activeRentals ?? 0} icon="📝" accent="violet" />
        <StatCard label="Monthly Revenue" value={s.monthlyRevenue ?? 0} icon="💰" accent="green" />
        <StatCard label="Expiring (7d)" value={s.expiring7dCount ?? 0} icon="⏳" accent={s.expiring7dCount ? 'amber' : 'slate'} />
        <StatCard label="Waitlist" value={s.waitlistCount ?? 0} icon="🪑" accent="amber" sub={s.maintenanceOpen ? `${s.maintenanceOpen} open maintenance` : ''} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-200/60 bg-white/80 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-1">⏳ Expiring in 7 days</h3>
          <p className="text-xs text-gray-500 mb-4">Renew ya release follow-up karein</p>
          {expiring.length === 0 ? (
            <EmptyState title="Koi expiring rental nahi" />
          ) : (
            <div className="space-y-2">
              {expiring.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-100/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {r.lockerCode} {r.location ? <span className="text-gray-500 font-normal">· {r.location}</span> : null}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{r.member}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.autoRenew ? <Badge tone="green">auto-renew</Badge> : <Badge tone="amber">manual</Badge>}
                    <span className="text-xs text-gray-600">
                      {r.endDate ? new Date(r.endDate).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200/60 bg-white/80 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-1">🚀 Quick Links</h3>
          <p className="text-xs text-gray-500 mb-4">Locker management shortcuts</p>
          <div className="grid gap-2">
            {QUICK_LINKS.map((q) => (
              <a key={q.href} href={q.href} className="flex items-center justify-between rounded-xl bg-gray-100/40 px-4 py-3 hover:bg-slate-700/40 transition">
                <div>
                  <div className="text-sm font-medium text-gray-900">{q.label}</div>
                  <div className="text-xs text-gray-500">{q.desc}</div>
                </div>
                <span className="text-gray-500">→</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
