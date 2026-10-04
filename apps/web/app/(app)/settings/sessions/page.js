'use client';

import { useEffect, useState } from 'react';
import { api, clearTokens } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, Badge, EmptyState } from '../../../../components/ui';

function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'abhi';
  if (s < 3600) return `${Math.floor(s / 60)} min pehle`;
  if (s < 86400) return `${Math.floor(s / 3600)} ghante pehle`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'kal' : `${d} din pehle`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [notice, setNotice] = useState('');

  const load = () => {
    setLoading(true); setError('');
    api.get('/sessions')
      .then((d) => setSessions(d.sessions || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const revokeOne = async (id, isCurrent) => {
    if (!window.confirm(isCurrent ? 'Yeh current device hai — logout ho jayenge. Continue?' : 'Is session ko revoke karein?')) return;
    setRevoking(id); setError(''); setNotice('');
    try {
      const d = await api.del(`/sessions/${id}`);
      if (d.loggedOut) {
        clearTokens();
        window.location = '/login';
        return;
      }
      setNotice('Session revoke ho gayi.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRevoking(null);
    }
  };

  const revokeAll = async () => {
    if (!window.confirm('Tamam doosre devices se logout kar dein?')) return;
    setRevokingAll(true); setError(''); setNotice('');
    try {
      const d = await api.post('/sessions/revoke-all', {});
      setNotice(`${d.revoked || 0} session(s) revoke ho gayin.`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRevokingAll(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Login Sessions"
        sub="Jahan jahan aap logged in hain — device, IP aur last activity dekhein, kisi bhi session ko revoke karein."
        actions={
          <button
            onClick={revokeAll}
            disabled={revokingAll || sessions.length <= 1}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40 transition"
          >
            {revokingAll ? 'Ho raha hai…' : '🚪 Log out all devices'}
          </button>
        }
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
          {notice}
        </div>
      )}
      {sessions.length === 0 ? (
        <EmptyState title="Koi active session nahi" hint="Dobara login karein." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`rounded-2xl border p-5 bg-gradient-to-br from-[#151527] to-[#0e0e1c] ${
                s.current ? 'border-blue-500/50 shadow-[0_0_24px_rgba(59,130,246,0.25)]' : 'border-white/10'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="text-3xl">💻</div>
                {s.current ? <Badge tone="blue">● Current device</Badge> : <Badge tone="slate">Active</Badge>}
              </div>
              <div className="font-semibold text-white mb-1">{s.deviceName || 'Unknown device'}</div>
              <div className="text-sm text-slate-400 space-y-1">
                <div>🌐 IP: <span className="text-slate-200 font-mono">{s.ipAddress || '—'}</span></div>
                <div>🕒 Last active: <span className="text-slate-200">{timeAgo(s.lastActiveAt)}</span></div>
                <div>📅 Login: <span className="text-slate-200">{new Date(s.createdAt).toLocaleString()}</span></div>
              </div>
              <button
                onClick={() => revokeOne(s.id, s.current)}
                disabled={revoking === s.id}
                className="mt-4 w-full px-3 py-2 rounded-xl text-sm font-semibold bg-white/5 text-red-300 border border-white/10 hover:bg-red-500/15 hover:border-red-500/30 disabled:opacity-40 transition"
              >
                {revoking === s.id ? 'Revoke ho raha…' : s.current ? 'Is device se logout' : 'Revoke session'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
