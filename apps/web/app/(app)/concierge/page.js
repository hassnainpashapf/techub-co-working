'use client';

// Phase 55 Track 10/10: Concierge Dashboard — StatCards, quick links, open requests preview.
// Backend: /api/concierge-dashboard (mount: app.use('/api/concierge-dashboard', require('./routes/concierge-dashboard'))).
// Sidebar link: { label: 'Concierge', path: '/concierge' } — roles: ceo/admin/super_admin/manager.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const QUICK_LINKS = [
  { label: '📋 Service Catalog', href: '/concierge/services', desc: 'Services add/edit karein' },
  { label: '🧾 Requests Board', href: '/concierge/board', desc: 'Kanban — new → done' },
  { label: '🏢 Providers', href: '/concierge/providers', desc: 'Partner service providers' },
  { label: '⏱️ SLA', href: '/concierge/sla', desc: 'Breaches check karein' },
];

function slaBadge(r) {
  if (r.sla === 'breached') return <Badge tone="red">⏰ SLA breach</Badge>;
  return <Badge tone="green">OK</Badge>;
}

function prioBadge(p) {
  const tones = { urgent: 'red', high: 'amber', normal: 'blue', low: 'slate' };
  return <Badge tone={tones[p] || 'blue'}>{p || 'normal'}</Badge>;
}

export default function ConciergeDashboardPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        setLoading(true);
        const s = await api.get('/api/concierge-dashboard/stats');
        setStats(s.data || {});
        try {
          const o = await api.get('/api/concierge-dashboard/open?limit=10');
          setOpen(o.data?.open || []);
        } catch (_) {}
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

  return (
    <div className="p-6 mx-auto space-y-3">
      <PageHeader title="🛎️ Concierge Dashboard" subtitle="Service requests, SLA, ratings aur revenue" />

      {pendingModules.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          ⚠️ Kuch modules abhi live nahi: {pendingModules.join(', ')} — schema merge ke baad auto-live.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Open Requests" value={s.openRequests ?? 0} icon="📋" accent="blue" />
        <StatCard label="SLA Breaches" value={s.slaBreaches ?? 0} icon="⏱️" accent={s.slaBreaches ? 'red' : 'green'} />
        <StatCard label="Avg Completion" value={s.avgCompletionHours != null ? `${s.avgCompletionHours}h` : '—'} icon="⚡" accent="violet" />
        <StatCard label="Avg Rating" value={s.avgRating != null ? `${s.avgRating} ★` : '—'} icon="⭐" accent="amber" sub={s.ratingCount ? `${s.ratingCount} ratings (30d)` : ''} />
        <StatCard label="Revenue (30d)" value={s.revenue30d ?? 0} icon="💰" accent="green" />
        <StatCard label="Done (30d)" value={s.byStatus?.done ?? 0} icon="✅" accent="indigo" />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="font-bold text-gray-900 mb-3">🔥 Top Services (30d)</h3>
          {s.topServices?.length ? (
            <div className="space-y-3">
              {s.topServices.map((t, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-800 text-sm">{i + 1}. {t.name}</span>
                  <Badge tone="blue">{t.count} requests</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Abhi koi data nahi" />
          )}
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="font-bold text-gray-900 mb-3">🔗 Quick Links</h3>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_LINKS.map((q) => (
              <a key={q.href} href={q.href} className="rounded-xl border border-gray-200 bg-gray-100 p-4 hover:border-indigo-400/40 hover:bg-gray-100 transition-all">
                <div className="font-semibold text-gray-900 text-sm">{q.label}</div>
                <div className="text-xs text-gray-500 mt-1">{q.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <h3 className="font-bold text-gray-900 mb-3">📋 Open Requests (preview)</h3>
        {open.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4">Request</th>
                  <th className="py-2 pr-4">Member</th>
                  <th className="py-2 pr-4">Service</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Priority</th>
                  <th className="py-2">SLA</th>
                </tr>
              </thead>
              <tbody>
                {open.map((r) => (
                  <tr key={r.id} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-900">{r.title}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.member}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.service}</td>
                    <td className="py-2 pr-4"><Badge tone="blue">{r.status}</Badge></td>
                    <td className="py-2 pr-4">{prioBadge(r.priority)}</td>
                    <td className="py-2">{slaBadge(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Koi open request nahi" />
        )}
      </div>
    </div>
  );
}
