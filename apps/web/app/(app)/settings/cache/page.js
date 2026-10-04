'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

export default function CacheSettingsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/cache/stats')
      .then((d) => setStats(d.stats || null))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const clear = async () => {
    if (!confirm('Clear the entire response cache?')) return;
    setClearing(true); setError(''); setMsg('');
    try {
      const d = await api.del('/cache');
      setMsg(`Cache cleared — ${d.cleared || 0} entries removed.`);
      load();
    } catch (err) { setError(err.message); }
    finally { setClearing(false); }
  };

  const hitPct = stats ? Math.round((stats.hitRate || 0) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Response Cache"
        sub="In-memory cache for heavy read endpoints (dashboard, reports). Writes auto-invalidate."
        actions={<button onClick={clear} disabled={clearing} className="btn-secondary">{clearing ? 'Clearing…' : 'Clear Cache'}</button>}
      />

      {error && <ErrorBanner message={error} />}
      {msg && <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard label="Hit rate" value={`${hitPct}%`} sub={`${stats?.hits || 0} hits / ${stats?.misses || 0} misses`} accent="emerald" />
        <StatCard label="Entries" value={stats?.size ?? 0} sub={`max ${stats?.max ?? 500}`} accent="blue" />
        <StatCard label="Hits" value={stats?.hits ?? 0} sub="served from cache" accent="violet" />
        <StatCard label="Misses" value={stats?.misses ?? 0} sub="computed fresh" accent="amber" />
      </div>

      <div className="card-premium p-5 text-sm text-gray-500">
        <h3 className="text-gray-900 font-semibold mb-2">How it works</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Dashboard responses are cached for 30s, report responses for 120s.</li>
          <li>Cache keys always include the tenant — one tenant can never see another's data.</li>
          <li>Any booking, member, invoice or payment change clears the tenant's cache instantly.</li>
          <li>Look for the <code className="text-gray-800">X-Cache: HIT/MISS</code> response header.</li>
        </ul>
      </div>
    </div>
  );
}
