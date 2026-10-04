'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'food', label: '🍔 Food & Drink' },
  { value: 'fitness', label: '💪 Fitness' },
  { value: 'tech', label: '💻 Tech' },
  { value: 'travel', label: '✈️ Travel' },
  { value: 'other', label: '🎁 Other' },
];
const catLabel = (c) => (CATEGORIES.find((x) => x.value === c) || {}).label || c;

function fmtDate(s) {
  if (!s) return 'No expiry';
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PortalPerksPage() {
  const [perks, setPerks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('all');
  const [claiming, setClaiming] = useState(null);
  const [revealed, setRevealed] = useState({}); // perkId -> code

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = category !== 'all' ? `?category=${category}` : '';
      const data = await api.get(`/perks${params}`);
      setPerks(data.perks || []);
    } catch (e) {
      setError(e.message || 'Failed to load perks');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [category]);

  async function claim(p) {
    setClaiming(p.id);
    try {
      const data = await api.post(`/perks/${p.id}/claim`);
      setRevealed((r) => ({ ...r, [p.id]: data.code || 'CLAIMED' }));
      setPerks((ps) => ps.map((x) => (x.id === p.id ? { ...x, claimed: true } : x)));
    } catch (e) {
      alert(e.message || 'Claim failed');
    } finally {
      setClaiming(null);
    }
  }

  if (loading) return <Spinner />;
  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Member Perks" sub="Exclusive deals from our partners — just for you" />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button key={c.value} onClick={() => setCategory(c.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${category === c.value ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-100'}`}>
            {c.label}
          </button>
        ))}
      </div>

      {perks.length === 0 ? (
        <EmptyState title="No perks yet" hint="New partner deals will appear here soon." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {perks.map((p) => {
            return (
              <div key={p.id} className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white/10 to-white/5 p-5 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{p.partnerName}</div>
                    <h3 className="mt-1 text-lg font-semibold text-gray-900">{p.title}</h3>
                  </div>
                  <Badge tone="blue">{p.discountText}</Badge>
                </div>
                {p.description && <p className="mt-2 text-sm text-gray-600">{p.description}</p>}
                <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                  <span>{catLabel(p.category)}</span>
                  <span>Expires: {fmtDate(p.expiryDate)}</span>
                </div>
                <div className="mt-4">
                  {revealed[p.id] ? (
                    <div className="rounded-lg border border-dashed border-amber-400/50 bg-amber-400/10 px-3 py-2 text-center">
                      <div className="text-xs text-amber-700">Your code:</div>
                      <div className="text-lg font-bold tracking-widest text-amber-700">{revealed[p.id]}</div>
                      <div className="mt-1 text-xs text-gray-500">Show this at the partner outlet</div>
                    </div>
                  ) : (
                    <button
                      onClick={() => claim(p)}
                      disabled={claiming === p.id}
                      className="w-full rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f766e] disabled:opacity-50">
                      {claiming === p.id ? 'Loading…' : p.claimed ? 'Show my code' : 'Claim this perk'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
