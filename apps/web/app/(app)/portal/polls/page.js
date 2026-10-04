'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

export default function PortalPollsPage() {
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [voting, setVoting] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/polls');
      setPolls((data.polls || []).filter((p) => p.status === 'open' || p.status === 'closed'));
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Failed to load polls.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const vote = async (pollId, optionId) => {
    setVoting(pollId);
    setError('');
    try {
      const { data } = await api.post(`/polls/${pollId}/vote`, { optionId });
      setPolls((ps) => ps.map((p) => (p.id === pollId ? { ...p, ...data } : p)));
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Vote failed.');
    } finally {
      setVoting(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Community Polls" subtitle="Your opinion matters — vote!" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : polls.length === 0 ? (
        <EmptyState icon="🗳️" title="No polls right now" text="Check back later — the community team posts polls here." />
      ) : (
        <div className="grid gap-4">
          {polls.map((p) => (
            <div key={p.id} className="card-premium p-5">
              <div className="flex items-center justify-between mb-3">
                <Badge color={p.status === 'open' ? 'green' : 'amber'}>{p.status}</Badge>
                {p.closesAt && p.status === 'open' && (
                  <span className="text-xs text-slate-500">Closes {new Date(p.closesAt).toLocaleString()}</span>
                )}
              </div>
              <p className="text-gray-900 font-semibold mb-4">{p.question}</p>
              {p.status === 'open' ? (
                <div className="space-y-2">
                  {(p.options || []).map((o) => {
                    const mine = p.myVote?.optionId === o.id;
                    return (
                      <button
                        key={o.id}
                        disabled={voting === p.id}
                        onClick={() => vote(p.id, o.id)}
                        className={`w-full text-left rounded-xl px-4 py-3 border text-sm transition ${
                          mine
                            ? 'bg-[#0f766e]/20 border-[#0f766e]/50 text-blue-100'
                            : 'bg-gray-100 border-gray-200 text-gray-800 hover:border-[#0f766e]/40'
                        }`}
                      >
                        <span className="flex items-center justify-between">
                          {o.text}
                          {mine && <span className="text-teal-700">✓ Your vote</span>}
                        </span>
                      </button>
                    );
                  })}
                  {p.myVote && <p className="text-xs text-slate-500">Tap another option to change your vote.</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  {(p.breakdown || []).map((b) => (
                    <div key={b.optionId}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>
                          {b.text} {p.myVote?.optionId === b.optionId && <span className="text-teal-700">✓ you</span>}
                        </span>
                        <span className="text-gray-500">{b.percent ?? 0}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#0f766e] to-teal-600"
                          style={{ width: `${b.percent ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-slate-500">{p.totalVotes} votes total</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
