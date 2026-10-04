'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const GRADE_STYLES = {
  A: 'bg-emerald-500/15 text-emerald-700 border-emerald-200',
  B: 'bg-blue-500/15 text-blue-700 border-blue-200',
  C: 'bg-amber-500/15 text-amber-700 border-amber-200',
  D: 'bg-slate-500/15 text-gray-500 border-slate-500/30',
};

// Phase 39 Track 6: Lead score badge — grade color + breakdown tooltip (explainable scoring).
export function ScoreBadge({ leadId, score, grade }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open || detail || loading) return;
    if (!leadId) return;
    setLoading(true);
    api.get(`/api/leads/${leadId}/score`)
      .then((res) => setDetail(res))
      .catch(() => setDetail({ breakdown: [] }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open ]);

  const style = GRADE_STYLES[grade] || GRADE_STYLES.D;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Score breakdown dekhein"
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-semibold cursor-pointer hover:brightness-125 ${style}`}
      >
        <span>{grade || '–'}</span>
        <span className="opacity-80">{score ?? '–'}</span>
      </button>
      {open && (
        <div className="absolute z-30 right-0 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-xl shadow-black/50">
          <p className="text-xs font-semibold text-gray-800 mb-2">
            Score {detail?.score ?? score} <span className="text-slate-500">({detail?.grade || grade})</span>
          </p>
          {loading && <p className="text-xs text-slate-500">Load ho raha hai…</p>}
          {!loading && detail && (
            <ul className="space-y-1 max-h-56 overflow-auto">
              {(detail.breakdown || []).map((b, i) => (
                <li key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500 truncate mr-2">{b.label}</span>
                  <span className={b.points < 0 ? 'text-red-400' : 'text-emerald-700'}>
                    {b.points > 0 ? `+${b.points}` : b.points}
                  </span>
                </li>
              ))}
              {(!detail.breakdown || detail.breakdown.length === 0) && (
                <li className="text-[11px] text-slate-500">Koi signal nahi</li>
              )}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-gray-500">Simple heuristic — ML nahi</p>
        </div>
      )}
    </div>
  );
}
