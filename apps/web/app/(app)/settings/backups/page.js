'use client';

import { useEffect, useState } from 'react';
import { api, apiDownload } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, StatCard } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = Number(bytes), i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

export default function BackupsPage() {
  const { allowed } = useRequireRoles(['super_admin']);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [running, setRunning] = useState(false);
  const [restoreId, setRestoreId] = useState(null);
  const [restoreDry, setRestoreDry] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const load = () => {
    setLoading(true); setError('');
    api.get('/backups')
      .then((d) => setBackups(d.backups || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const runNow = async () => {
    setRunning(true); setMsg(''); setError('');
    try {
      const d = await api.post('/backups/run', { note: 'Manual backup from admin UI.' });
      setMsg(`Backup ban gaya: ${d.backup.fileName} (${fmtSize(d.backup.sizeBytes)})`);
      load();
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  };

  const download = (b) => apiDownload(`/backups/${b.id}/download`, b.fileName).catch((e) => setError(e.message));

  const del = async (b) => {
    if (!window.confirm(`"${b.fileName}" delete kar dein? File disk se bhi hat jayegi.`)) return;
    setError(''); setMsg('');
    try { await api.del(`/backups/${b.id}`); setMsg('Backup delete ho gaya.'); load(); }
    catch (e) { setError(e.message); }
  };

  const dryRun = async (b) => {
    setRestoreId(b.id); setRestoreDry(null); setError(''); setMsg('');
    try {
      const d = await api.post(`/backups/${b.id}/restore`, { confirm: false });
      setRestoreDry(d);
    } catch (e) { setError(e.message); setRestoreId(null); }
  };

  const doRestore = async () => {
    setRestoring(true); setError(''); setMsg('');
    try {
      const d = await api.post(`/backups/${restoreId}/restore`, { confirm: true });
      setMsg(`Restore complete. Safety backup: ${d.safetyBackup}`);
      setRestoreId(null); setRestoreDry(null); load();
    } catch (e) { setError(e.message); }
    finally { setRestoring(false); }
  };

  const total = backups.reduce((s, b) => s + Number(b.sizeBytes || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Database Backups"
        subtitle="Nightly automatic backups (2:30 AM) + manual. Sirf super_admin."
        actions={<button onClick={runNow} disabled={running} className="btn-primary">{running ? 'Ban raha hai…' : '⬇ Run Backup Now'}</button>}
      />
      {error && <ErrorBanner message={error} />}
      {msg && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{msg}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Backups" value={backups.length} />
        <StatCard label="Total Size" value={fmtSize(total)} />
        <StatCard label="Retention" value="7 daily" />
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><h3 className="font-semibold">Backup History</h3></div>
        {loading ? <div className="p-8 flex justify-center"><Spinner /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-white/10">
                <th className="px-4 py-3">File</th><th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Created</th><th className="px-4 py-3">Note</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {backups.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Koi backup nahi — "Run Backup Now" dabayein.</td></tr>}
                {backups.map((b) => (
                  <tr key={b.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-mono text-xs">{b.fileName}{!b.exists && <span className="ml-2 text-amber-300">(file missing)</span>}</td>
                    <td className="px-4 py-3">{fmtSize(b.sizeBytes)}</td>
                    <td className="px-4 py-3 text-slate-300">{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate">{b.note || '—'}</td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button onClick={() => download(b)} className="btn-ghost btn-sm">⬇</button>
                      <button onClick={() => dryRun(b)} className="btn-ghost btn-sm" title="Restore (dry-run check)">♻</button>
                      <button onClick={() => del(b)} className="btn-ghost btn-sm text-red-300">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {restoreId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md w-full p-6 space-y-4">
            <h3 className="font-semibold text-lg text-amber-200">⚠ Database Restore</h3>
            {!restoreDry && <div className="flex justify-center py-4"><Spinner /></div>}
            {restoreDry && (
              <>
                <div className="text-sm space-y-1">
                  <p>File exists: <b>{restoreDry.checks.fileExists ? '✅' : '❌'}</b></p>
                  <p>Gzip valid: <b>{restoreDry.checks.gzipOk ? '✅' : '❌'}</b></p>
                  <p>SQL dump jaisa lagta hai: <b>{restoreDry.checks.looksLikeSql ? '✅' : '❌'}</b></p>
                </div>
                <p className="text-sm text-slate-300">Restore se pehle <b>safety backup</b> khud ban jayega. Phir bhi ye action poora database badal dega.</p>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setRestoreId(null); setRestoreDry(null); }} className="btn-ghost">Cancel</button>
                  <button onClick={doRestore} disabled={restoring || !restoreDry.checks.gzipOk || !restoreDry.checks.looksLikeSql} className="btn-danger">
                    {restoring ? 'Restore ho raha hai…' : 'Confirm Restore'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="card p-4 text-xs text-slate-400">
        <b className="text-slate-200">Kaise kaam karta hai:</b> roz raat 2:30 baje job queue se automatic backup banta hai.
        pg_dump maujood ho to full backup (schema + data), warna data-only fallback. Purane backups me se sirf latest 7 rakhe jate hain.
        Restore sirf yahan se, dry-run check + safety backup ke baad.
      </div>
    </div>
  );
}
