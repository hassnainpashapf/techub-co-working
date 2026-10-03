'use client';
// Phase 40 Track 9 — Introductions widget (coordinator: members page par drop-in kare).
// Props: memberId (optional — diya ho to us member ke intros, warna pending inbox).
// COORDINATOR INTEGRATION: members/page.js me
//   import IntroductionsWidget from '@/components/IntroductionsWidget';
// aur page me <IntroductionsWidget /> render kare (members header ke paas ya side panel me).
import { useEffect, useState } from 'react';

export default function IntroductionsWidget() {
  const [intros, setIntros] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/intros/pending', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setIntros(Array.isArray(d) ? d : []))
      .catch(() => setIntros([]))
      .finally(() => setLoading(false));
  }, []);

  async function act(id, action) {
    const r = await fetch(`/api/intros/${id}/${action}`, { method: 'POST', credentials: 'include' });
    if (r.ok) setIntros((xs) => xs.filter((x) => x.id !== id));
  }

  if (loading) return null;
  if (!intros.length) return null;

  return (
    <div className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-[#1c1c30] to-[#12121f] p-4 shadow-lg">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">🤝</span>
        <h3 className="text-sm font-semibold text-slate-100">Intro Suggestions ({intros.length})</h3>
      </div>
      <div className="space-y-2">
        {intros.slice(0, 5).map((i) => (
          <div key={i.id} className="rounded-xl bg-white/5 p-3">
            <div className="text-sm font-medium text-slate-100">
              {i.newMember?.name} <span className="text-slate-400">↔</span> {i.suggestedMember?.name}
            </div>
            <div className="mt-1 text-xs text-slate-400">{i.reason}</div>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[11px] text-blue-300">score {i.score}</span>
              <button
                onClick={() => act(i.id, 'introduce')}
                className="rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
              >
                Introduce
              </button>
              <button
                onClick={() => act(i.id, 'dismiss')}
                className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
