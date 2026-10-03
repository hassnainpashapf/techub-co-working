'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Phase 40 Track 8: Milestones feed — reusable component.
// Use: celebrations page par "Milestones" tab ke andar, aur staff dashboard widget me.
//   import { MilestonesList } from '../../components/MilestonesList';
//   <MilestonesList limit={10} compact />
export function MilestonesList({ limit = 20, compact = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/milestones/recent?limit=${limit}`)
      .then((res) => setItems(res.milestones || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [limit]);

  if (loading) {
    return <div className="text-sm text-slate-400">Milestones load ho rahe hain…</div>;
  }
  if (!items.length) {
    return (
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
        🎉 Abhi tak koi milestone celebrate nahi hua. Milestone detector rozana chalta hai — 100th booking, anniversaries, 50 events, 10 referrals, 1000 loyalty points par auto celebrate hoga.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((m, i) => (
        <div
          key={`${m.key}-${m.memberId}-${i}`}
          className={`flex items-center gap-3 rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-transparent p-3 ${compact ? '' : 'md:p-4'}`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xl">
            🎉
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-100">
              {m.memberName} <span className="font-normal text-amber-300">— {m.label}</span>
            </div>
            <div className="text-xs text-slate-400">
              {m.celebratedAt ? new Date(m.celebratedAt).toLocaleDateString() : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
