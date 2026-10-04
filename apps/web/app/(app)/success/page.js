'use client';

// Phase 54 Track 10/10: Member Success Dashboard — StatCards, at-risk table, quick links.
// Backend: /api/success-dashboard (mount coordinator karega). Sidebar link coordinator jodega.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

function healthTone(score) {
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

function factorLabel(f) {
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object') {
    return Object.entries(f)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }
  return '—';
}

const QUICK_LINKS = [
  { label: '🛬 Onboarding Journeys', href: '/success/onboarding', desc: 'Member journeys aur progress' },
  { label: '💓 Health Scores', href: '/success/onboarding', desc: 'Track 2 ka view wahan bhi milega' },
  { label: '🤝 Buddy Program', href: '/success/onboarding', desc: 'Newcomer–buddy pairs' },
  { label: '📩 Win-Back', href: '/success/onboarding', desc: 'Campaigns aur offers' },
];

export default function SuccessDashboardPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [data, setData] = useState(null);
  const [atRisk, setAtRisk] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        setLoading(true);
        const s = await api.get('/api/success-dashboard/stats');
        setData(s.data || {});
        try {
          const r = await api.get('/api/success-dashboard/at-risk?limit=10');
          setAtRisk(r.data?.atRisk || []);
        } catch (e2) {
          // Health module abhi merge na hua ho to at-risk optional hai
          setAtRisk([]);
        }
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Dashboard load nahi ho saka');
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const stats = data?.stats || {};
  const modules = data?.modules || {};

  return (
    <div className="space-y-6">
      <PageHeader title="Member Success" subtitle="Onboarding, health, feedback aur win-back ka overview" />

      {err && <ErrorBanner message={err} />}

      {Object.keys(modules).length < 5 && (
        <div className="card p-4 text-sm text-yellow-300 border border-yellow-500/30 bg-yellow-500/10">
          ⚠️ Kuch modules abhi merge/deploy nahi hue — un ke stats 0 dikhai denge. Health module pending ho to at-risk table khali rahegi.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Active Journeys" value={stats.activeJourneys ?? '—'} icon="🛬" />
        <StatCard label="Avg Health Score" value={stats.healthSample ? `${stats.avgHealthScore}/100` : '—'} icon="💓" />
        <StatCard label="At-Risk Members" value={stats.atRiskCount ?? '—'} icon="🚨" />
        <StatCard label="NPS (30d)" value={stats.nps30d === null || stats.nps30d === undefined ? '—' : stats.nps30d} icon="📊" />
        <StatCard label="Win-Back Sent" value={stats.winbackSent ?? '—'} icon="📩" />
        <StatCard label="Open Tasks" value={stats.openSuccessTasks ?? '—'} icon="📝" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">🚨 At-Risk Members</h3>
            <Badge tone={atRisk.length ? 'red' : 'green'}>{atRisk.length} flagged</Badge>
          </div>
          {!atRisk.length ? (
            <EmptyState title="Koi at-risk member nahi — sab ki health 40+ hai (ya health module abhi pending hai)." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="py-2 pr-3">Member</th>
                    <th className="py-2 pr-3">Score</th>
                    <th className="py-2 pr-3">Journey</th>
                    <th className="py-2">Factors</th>
                  </tr>
                </thead>
                <tbody>
                  {atRisk.map((r) => (
                    <tr key={r.memberId} className="border-b border-slate-800 hover:bg-slate-800/40">
                      <td className="py-2 pr-3">
                        <div className="text-white font-medium">{r.memberName || '—'}</div>
                        <div className="text-xs text-slate-400">{r.memberEmail || ''}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={healthTone(r.score)}>{r.score}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {r.journey ? `${r.journey.status}${r.journey.currentStage ? ` · stage ${r.journey.currentStage}` : ''}` : '—'}
                      </td>
                      <td className="py-2 text-xs text-slate-400 max-w-[200px] truncate" title={factorLabel(r.factors)}>
                        {factorLabel(r.factors)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-lg font-semibold text-white mb-4">⚡ Quick Links</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {QUICK_LINKS.map((q) => (
              <a key={q.label} href={q.href} className="card p-4 hover:border-indigo-500/50 transition-colors">
                <div className="text-white font-medium">{q.label}</div>
                <div className="text-xs text-slate-400 mt-1">{q.desc}</div>
              </a>
            ))}
          </div>
          <div className="mt-4 text-sm text-slate-300 space-y-1">
            <div>💓 Health sample: <span className="text-white font-semibold">{stats.healthSample ?? 0}</span> members</div>
            <div>📊 NPS responses (30d): <span className="text-white font-semibold">{stats.npsResponses ?? 0}</span></div>
            <div>📩 Win-back campaigns: <span className="text-white font-semibold">{stats.winbackCampaigns ?? 0}</span></div>
            <div>⏰ Overdue tasks: <span className="text-white font-semibold">{stats.overdueSuccessTasks ?? 0}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
