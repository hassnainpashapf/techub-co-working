'use client';

// Phase 48 Track 10/10: Access Dashboard — stats, live feed (30s polling),
// who's-in-building list, quick links.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s pehle`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m pehle`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h pehle`;
  return new Date(iso).toLocaleDateString();
}

function LiveFeed({ events }) {
  if (!events || !events.length) return <EmptyState title="Koi entry events nahi" />;
  return (
    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm ${e.result === 'granted' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-700'}`}>
            {e.direction === 'in' ? '→' : '←'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{e.member || 'Unknown visitor'}</div>
            <div className="text-xs text-gray-500 truncate">{e.door || '—'} • {e.credentialType || ''} {e.reason ? `• ${e.reason}` : ''}</div>
          </div>
          <Badge tone={e.result === 'granted' ? 'green' : 'red'}>{e.result === 'granted' ? 'Granted' : 'Denied'}</Badge>
          <span className="text-xs text-slate-500 whitespace-nowrap">{timeAgo(e.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AccessDashboardPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'ops');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [live, setLive] = useState({ events: [], inside: [] });

  const load = useCallback(async (silent) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const [s, l] = await Promise.all([
        api.get('/api/access-dashboard/stats'),
        api.get('/api/access-dashboard/live'),
      ]);
      setStats(s.stats || {});
      setLive({ events: l.events || [], inside: l.inside || [] });
    } catch (e) {
      if (!silent) setError(e.message || 'Load nahi hua');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { if (allowed) load(false); }, [allowed, load]);
  useEffect(() => {
    if (!allowed) return;
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
  }, [allowed, load]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="p-6"><Spinner /></div>;

  const s = stats || {};
  return (
    <div className="p-6 space-y-6">
      <PageHeader title="🔐 Access Dashboard" sub="Doors, entries aur live activity" actions={
        <button onClick={() => load(false)} className="btn-secondary">↻ Refresh</button>
      } />
      {error && <ErrorBanner message={error} />}

      {s.missing && s.missing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Access module ke kuch models abhi merge nahi hue ({s.missing.join(', ')}). Wo sections khali dikhen ge.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Entries aaj" value={s.entriesToday ?? '—'} accent="green" />
        <StatCard label="Denied aaj" value={s.deniedToday ?? '—'} accent="red" />
        <StatCard label="Active credentials" value={s.activeCredentials ?? '—'} accent="blue" />
        <StatCard label="Active doors" value={s.activeDoors ?? '—'} accent="violet" />
        <StatCard label="Pending passes" value={s.pendingPasses ?? '—'} accent="amber" />
        <StatCard label="Anomalies (24h)" value={s.anomalies24h ?? '—'} accent="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold mb-4">📡 Live Feed</h3>
          <LiveFeed events={live.events} />
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold mb-4">🏢 Who's In ({live.inside.length})</h3>
          {!live.inside.length ? (
            <EmptyState title="Abhi koi andar nahi" />
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {live.inside.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-gray-500">{m.phone || ''}</div>
                  </div>
                  <span className="text-xs text-slate-500">{m.enteredAt ? timeAgo(m.enteredAt) + ' se' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-lg font-semibold mb-4">⚡ Quick Links</h3>
        <div className="flex flex-wrap gap-3">
          <a href="/access/doors" className="btn-secondary">🚪 Doors</a>
          <a href="/access/desk" className="btn-secondary">🧾 Reception Desk</a>
          <a href="/access/passes" className="btn-secondary">🎫 Day Passes</a>
        </div>
      </div>
    </div>
  );
}
