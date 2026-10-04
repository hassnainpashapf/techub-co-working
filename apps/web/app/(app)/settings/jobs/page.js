'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const STATUS_STYLES = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  processing: 'bg-[#8b5cf6]/15 text-[#c4b5fd] border-[#8b5cf6]/30',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-300 border-red-500/30',
};

function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>;
}

const FILTERS = ['', 'pending', 'processing', 'completed', 'failed'];

export default function JobsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [jobs, setJobs] = useState([]);
  const [counts, setCounts] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(null);

  const load = (silent = false) => {
    if (!silent) setError('');
    api.get(`/jobs${filter ? `?status=${filter}` : ''}`)
      .then((d) => { setJobs(d.jobs || []); setCounts(d.counts || []); })
      .catch((e) => { if (!silent) setError(e.message); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!allowed) return;
    load();
    const t = setInterval(() => load(true), 10000);
    return () => clearInterval(t);
  }, [allowed, filter]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const retry = async (id) => {
    setActing(id);
    try { await api.post(`/jobs/${id}/retry`); load(true); }
    catch (e) { setError(e.message); }
    finally { setActing(null); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this job?')) return;
    setActing(id);
    try { await api.del(`/jobs/${id}`); load(true); }
    catch (e) { setError(e.message); }
    finally { setActing(null); }
  };

  const countFor = (s) => counts.find((c) => c.status === s)?._count || 0;

  return (
    <div>
      <PageHeader title="Background Jobs" subtitle="Database-backed queue — worker polls every 5 seconds" />

      {error && <ErrorBanner message={error} />}

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              filter === f
                ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
            }`}
          >
            {f || 'All'}{f ? ` (${countFor(f)})` : ` (${counts.reduce((a, c) => a + (c._count || 0), 0)})`}
          </button>
        ))}
      </div>

      <div className="card-premium overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-white/10">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Run At</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No jobs found.</td></tr>
              )}
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-xs text-violet-200">{j.type}</td>
                  <td className="px-4 py-3"><StatusBadge status={j.status} /></td>
                  <td className="px-4 py-3 text-slate-300">{j.attempts}/{j.maxAttempts}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{j.runAt ? new Date(j.runAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-xs text-red-300/80 max-w-[280px] truncate" title={j.lastError || ''}>{j.lastError || '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {j.status === 'failed' && (
                      <button onClick={() => retry(j.id)} disabled={acting === j.id} className="text-xs px-2.5 py-1 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 mr-2 disabled:opacity-50">
                        {acting === j.id ? '…' : 'Retry'}
                      </button>
                    )}
                    <button onClick={() => remove(j.id)} disabled={acting === j.id} className="text-xs px-2.5 py-1 rounded-md bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Auto-refreshes every 10 seconds.</p>
    </div>
  );
}
