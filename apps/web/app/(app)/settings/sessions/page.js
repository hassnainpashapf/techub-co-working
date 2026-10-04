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
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-500/15 text-red-700 border border-red-200 hover:bg-red-500/25 disabled:opacity-40 transition"
          >
            {revokingAll ? 'Ho raha hai…' : '🚪 Log out all devices'}
          </button>
        }
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && (
        <div className="mb-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {notice}
        </div>
      )}
      {sessions.length === 0 ? (
        <EmptyState title="Koi active session nahi" hint="Dobara login karein." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`rounded-2xl border p-5 bg-white ${
                s.current ? 'border-[#0f766e]/50 shadow-[0_0_24px_rgba(15,118,110,0.25)]' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="text-3xl">💻</div>
                {s.current ? <Badge tone="blue">● Current device</Badge> : <Badge tone="slate">Active</Badge>}
              </div>
              <div className="font-semibold text-gray-900 mb-1">{s.deviceName || 'Unknown device'}</div>
              <div className="text-sm text-gray-500 space-y-1">
                <div>🌐 IP: <span className="text-gray-800 font-mono">{s.ipAddress || '—'}</span></div>
                <div>🕒 Last active: <span className="text-gray-800">{timeAgo(s.lastActiveAt)}</span></div>
                <div>📅 Login: <span className="text-gray-800">{new Date(s.createdAt).toLocaleString()}</span></div>
              </div>
              <button
                onClick={() => revokeOne(s.id, s.current)}
                disabled={revoking === s.id}
                className="mt-3 w-full px-3 py-2 rounded-xl text-sm font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 hover:border-red-300 disabled:opacity-40 transition"
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
