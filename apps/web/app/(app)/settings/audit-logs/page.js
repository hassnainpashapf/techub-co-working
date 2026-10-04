'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function actionColor(action) {
  if (!action) return 'slate';
  if (/delete|revoke|lockout|failed/i.test(action)) return 'red';
  if (/create|sent|verified/i.test(action)) return 'green';
  if (/update|change|login/i.test(action)) return 'blue';
  return 'slate';
}

function exportCsv(rows) {
  const header = ['Time', 'User', 'Action', 'Entity', 'EntityId', 'IP'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.join(',')].concat(
    rows.map((r) => [new Date(r.createdAt).toISOString(), r.actor?.name || r.actor?.email || '-', r.action, r.entity, r.entityId || '', r.ip || ''].map(esc).join(','))
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'audit-logs.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function AuditLogsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [tab, setTab] = useState('logs');
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [f, setF] = useState({ from: '', to: '', action: '', userId: '', entity: '' });

  const fetchLogs = async (p = 1, filters = f) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: p, limit: 25 });
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.action) params.set('action', filters.action);
      if (filters.userId) params.set('userId', filters.userId);
      if (filters.entity) params.set('entity', filters.entity);
      const data = await api.get(`/audit-logs?${params}`);
      setLogs(data.logs || []);
      setTotal(data.pagination?.total || 0);
      setPage(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    api.get('/users').then((d) => setUsers(d.users || [])).catch(() => {});
    fetchLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const pages = Math.ceil(total / 25);

  return (
    <div>
      <PageHeader title="Audit Logs" sub="Immutable record of all important actions" />

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { id: 'logs', label: 'Logs' },
          { id: 'retention', label: 'Retention' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={tab === t.id ? 'btn-primary' : 'btn-secondary'}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'retention' ? <RetentionTab /> : (
      <>
      {/* Filters */}
      <div className="card-premium p-4 mb-4 grid grid-cols-2 md:grid-cols-6 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">From</label>
          <input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">To</label>
          <input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Action search</label>
          <input className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="e.g. member.create" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">User</label>
          <select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
            <option value="">All users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Entity</label>
          <input className="input" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} placeholder="e.g. Member" />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-primary flex-1" onClick={() => fetchLogs(1)}>Filter</button>
          <button className="btn-secondary" onClick={() => exportCsv(logs)} title="Export filtered rows as CSV">CSV</button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading ? <Spinner /> : (
        <div className="card-premium overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="p-3">Time</th>
                <th className="p-3">User</th>
                <th className="p-3">Action</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Entity ID</th>
                <th className="p-3">IP</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((r) => (
                <>
                  <tr key={r.id} className="border-b border-gray-200 hover:bg-gray-100">
                    <td className="p-3 text-gray-600 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="p-3 text-gray-900">{r.actor?.name || r.actor?.email || <span className="text-slate-500">system</span>}</td>
                    <td className="p-3"><Badge tone={actionColor(r.action)}>{r.action}</Badge></td>
                    <td className="p-3 text-gray-600">{r.entity}</td>
                    <td className="p-3 text-gray-500 font-mono text-xs">{r.entityId ? r.entityId.slice(0, 8) + '…' : '—'}</td>
                    <td className="p-3 text-gray-500 font-mono text-xs">{r.ip || '—'}</td>
                    <td className="p-3">
                      <button className="text-xs text-teal-300 hover:text-violet-200" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr key={r.id + '-d'} className="border-b border-gray-200 bg-black/30">
                      <td colSpan={7} className="p-3">
                        <div className="grid md:grid-cols-2 gap-3 text-xs">
                          <div>
                            <div className="text-gray-500 font-semibold mb-1">Old value</div>
                            <pre className="bg-black/50 rounded p-2 overflow-auto max-h-40 text-gray-600">{JSON.stringify(r.oldValue, null, 2) || '—'}</pre>
                          </div>
                          <div>
                            <div className="text-gray-500 font-semibold mb-1">New value</div>
                            <pre className="bg-black/50 rounded p-2 overflow-auto max-h-40 text-gray-600">{JSON.stringify(r.newValue, null, 2) || '—'}</pre>
                          </div>
                        </div>
                        {r.userAgent && <div className="mt-2 text-slate-500 font-mono break-all">{r.userAgent}</div>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {logs.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No audit logs found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => fetchLogs(page - 1)}>‹ Prev</button>
          <span className="text-sm text-gray-500">Page {page} of {pages} ({total} total)</span>
          <button className="btn-secondary" disabled={page >= pages} onClick={() => fetchLogs(page + 1)}>Next ›</button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ---- Retention tab (Phase 32 Track 8) ----
function RetentionTab() {
  const [days, setDays] = useState(365);
  const [archives, setArchives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [s, a] = await Promise.all([
        api.get('/audit-retention/settings'),
        api.get('/audit-retention/archives'),
      ]);
      setDays(s.retentionDays ?? 365);
      setArchives(a.archives || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    try {
      const s = await api.put('/audit-retention/settings', { retentionDays: Number(days) });
      setDays(s.retentionDays);
      setResult({ message: `Retention set to ${s.retentionDays} days` });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!window.confirm('Archive and delete audit logs older than the retention window? Archives are verified before deletion.')) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const r = await api.post('/audit-retention/run', {});
      setResult(r);
      const a = await api.get('/audit-retention/archives');
      setArchives(a.archives || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      {error && <ErrorBanner message={error} />}
      {result && (
        <div className="card-premium p-4 mb-4 text-sm text-gray-800">
          {result.message
            ? result.message
            : `Archived ${result.archived ?? 0} logs, deleted ${result.deleted ?? 0} rows.`}
          {result.filePath && <div className="text-xs text-gray-500 mt-1 font-mono break-all">{result.filePath}</div>}
        </div>
      )}

      {/* Settings */}
      <div className="card-premium p-4 mb-4">
        <div className="text-sm font-semibold text-gray-900 mb-1">Retention window</div>
        <div className="text-xs text-gray-500 mb-3">
          Logs older than this are archived to a verified JSONL file and then deleted. Default 365 days (min 30, max 3650).
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={30}
            max={3650}
            className="input w-32"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <span className="text-sm text-gray-500">days</span>
          <button className="btn-primary" disabled={saving} onClick={saveSettings}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn-secondary" disabled={running} onClick={runNow}>
            {running ? 'Running…' : 'Run retention now'}
          </button>
        </div>
      </div>

      {/* Archives */}
      {loading ? <Spinner /> : (
        <div className="card-premium overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="p-3">Archived at</th>
                <th className="p-3">Period</th>
                <th className="p-3">Records</th>
                <th className="p-3">File</th>
              </tr>
            </thead>
            <tbody>
              {archives.map((a) => (
                <tr key={a.id} className="border-b border-gray-200 hover:bg-gray-100">
                  <td className="p-3 text-gray-600 whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</td>
                  <td className="p-3 text-gray-600 whitespace-nowrap">
                    {new Date(a.periodFrom).toLocaleDateString()} → {new Date(a.periodTo).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-gray-900">{a.recordCount}</td>
                  <td className="p-3 text-gray-500 font-mono text-xs break-all">{a.filePath || '—'}</td>
                </tr>
              ))}
              {archives.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">No archives yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
