'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PortalBadgesPage() {
  const [catalog, setCatalog] = useState([]);
  const [mine, setMine] = useState([]);
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [c, m, b] = await Promise.all([
          api.get('/badges'),
          api.get('/badges/mine'),
          api.get('/badges/leaderboard'),
        ]);
        setCatalog(c.badges || []);
        setMine(m.badges || []);
        setBoard(b.leaderboard || []);
      } catch (e) {
        setError(e.message || 'Badges load nahi hue');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="p-6"><Spinner /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <PageHeader title="Badges & Leaderboard" subtitle="Apni achievements dekho aur community me top bano" />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Meray Badges" value={mine.length} />
        <StatCard label="Total Badges" value={catalog.length} />
        <StatCard label="Leaderboard par" value={board.length} />
      </div>

      {/* Meri badge wall */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Meri Badge Wall</h2>
        {mine.length === 0 ? (
          <EmptyState title="Abhi koi badge nahi" message="Events attend karo, referrals lao aur feedback do — badges khud mil jayenge!" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {mine.map((b) => (
              <div key={b.id} className="rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 to-transparent p-4 text-center">
                <div className="text-4xl mb-2">{b.icon || '🏅'}</div>
                <div className="text-gray-900 font-medium text-sm">{b.name}</div>
                <div className="text-xs text-gray-500 mt-1">{fmtDate(b.awardedAt)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Catalog */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Tamam Badges</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {catalog.map((b) => (
            <div
              key={b.id}
              className={`rounded-xl border p-4 ${b.earned ? 'border-amber-400/30 bg-amber-500/5' : 'border-gray-200/50 bg-gray-100/40 opacity-70'}`}
            >
              <div className="flex items-start gap-3">
                <div className={`text-3xl ${b.earned ? '' : 'grayscale'}`}>{b.icon || '🏅'}</div>
                <div className="flex-1">
                  <div className="text-gray-900 font-medium text-sm">{b.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{b.description}</div>
                  <div className="text-xs mt-2">
                    {b.earned
                      ? <span className="text-amber-300">✅ Mil gaya</span>
                      : <span className="text-slate-500">{b.earnedCount} members ne liya</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Leaderboard */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">🏆 Leaderboard</h2>
        {board.length === 0 ? (
          <EmptyState title="Abhi koi ranking nahi" message="Pehle badges earn honge to leaderboard yahan dikhega" />
        ) : (
          <div className="rounded-xl border border-gray-200/50 overflow-hidden">
            {board.map((r, i) => (
              <div key={r.memberId} className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/40 last:border-0 bg-gray-100/30">
                <div className="w-8 text-center font-bold text-gray-600">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                </div>
                <div className="flex-1">
                  <div className="text-gray-900 text-sm font-medium">{r.name}</div>
                  {r.companyName && <div className="text-xs text-slate-500">{r.companyName}</div>}
                </div>
                <div className="text-lg">{r.latest.map((b) => b.icon).join(' ')}</div>
                <div className="text-amber-300 text-sm font-semibold">{r.badgeCount} badges</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
