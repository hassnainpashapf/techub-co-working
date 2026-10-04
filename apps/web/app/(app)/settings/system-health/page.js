'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, StatCard, Badge } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function fmtUptime(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function SystemHealthPage() {
  const { allowed } = useRequireRoles(['super_admin', 'ceo']);
  const [status, setStatus] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(null);
  const [checking, setChecking] = useState(false);

  const load = (silent = false) => {
    if (!silent) setError('');
    Promise.all([api.get('/health/status'), api.get('/health/metrics')])
      .then(([s, m]) => { setStatus(s); setMetrics(m); })
      .catch((e) => { if (!silent) setError(e.message); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!allowed) return;
    load();
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const retry = async (id) => {
    setActing(id);
    try { await api.post(`/jobs/${id}/retry`); load(true); }
    catch (e) { setError(e.message); }
    finally { setActing(null); }
  };

  const runCheck = async () => {
    setChecking(true);
    try { await api.post('/health/check-now'); load(true); }
    catch (e) { setError(e.message); }
    finally { setChecking(false); }
  };

  const db = status?.db || {};
  const queue = status?.queue || {};
  const cacheStats = status?.cache || {};
  const failed = metrics?.recentFailed || [];
  const dbOk = db.ok === true;
  const dbSlow = dbOk && db.latencyMs > 2000;

  return (
    <div>
      <PageHeader
        title="System Health"
        sub={`v${status?.version || '—'} · auto-refreshes every 30s`}
        actions={
          <button
            onClick={runCheck}
            disabled={checking}
            className="text-sm px-4 py-2 rounded-lg bg-[#0f766e] hover:bg-[#0f766e] text-white font-medium transition disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Run check now'}
          </button>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard
          label="Database"
          value={dbOk ? (dbSlow ? 'Slow' : 'Healthy') : 'Down'}
          sub={db.latencyMs != null ? `${db.latencyMs}ms latency` : 'no data'}
          accent={dbOk ? (dbSlow ? 'amber' : 'green') : 'red'}
        />
        <StatCard
          label="Job Queue"
          value={`${queue.pending || 0} pending`}
          sub={`${queue.failed || 0} failed · ${queue.processing || 0} processing`}
          accent={(queue.failed || 0) > 0 ? 'red' : 'green'}
        />
        <StatCard label="Uptime" value={fmtUptime(status?.uptimeSec)} sub="this process" accent="blue" />
        <StatCard
          label="Memory"
          value={status?.memory ? `${status.memory.heapUsedMb} MB` : '—'}
          sub={status?.memory ? `heap · RSS ${status.memory.rssMb} MB` : ''}
          accent="violet"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Cache hits" value={cacheStats.hits ?? '—'} sub={`${(cacheStats.hitRate ?? 0) * 100}% hit rate`} accent="slate" />
        <StatCard label="Cache misses" value={cacheStats.misses ?? '—'} sub={`${cacheStats.size ?? 0}/${cacheStats.max ?? 0} entries`} accent="slate" />
        <StatCard label="Email queue" value={metrics?.emailQueueDepth ?? '—'} sub="pending emails (24h window)" accent="slate" />
        <StatCard label="Last checked" value={status?.at ? new Date(status.at).toLocaleTimeString() : '—'} sub="server time" accent="slate" />
      </div>

      <h3 className="text-sm font-semibold text-gray-800 mb-3">
        Failed jobs <span className="text-slate-500 font-normal">(last 24h)</span>
      </h3>
      {failed.length === 0 ? (
        <p className="text-sm text-slate-500 bg-gray-100 border border-gray-200 rounded-xl px-4 py-6 text-center">
          No failed jobs in the last 24 hours 🎉
        </p>
      ) : (
        <div className="space-y-2">
          {failed.map((j) => (
            <div key={j.id} className="flex items-start justify-between gap-3 bg-gray-100 border border-gray-200 rounded-xl px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="red">failed</Badge>
                  <span className="text-sm font-medium text-gray-800">{j.type}</span>
                  <span className="text-xs text-slate-500">{j.attempts} attempts</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 truncate">{j.lastError || 'no error recorded'}</p>
                <p className="text-xs text-gray-500 mt-0.5">{j.updatedAt ? new Date(j.updatedAt).toLocaleString() : ''}</p>
              </div>
              <button
                onClick={() => retry(j.id)}
                disabled={acting === j.id}
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-[#0f766e]/40 bg-[#0f766e]/15 text-teal-700 hover:bg-[#0f766e]/25 transition disabled:opacity-50"
              >
                {acting === j.id ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
