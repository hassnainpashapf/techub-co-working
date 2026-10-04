'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// Phase 54: public 30-day onboarding feedback survey (no login).
export default function OnboardingSurveyPage() {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [meta, setMeta] = useState(null);
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const base = process.env.NEXT_PUBLIC_API_URL || '';
        const r = await fetch(`${base}/api/onboarding-feedback/${token}`);
        const d = await r.json();
        if (r.ok) { setMeta(d); setState(d.alreadySubmitted ? 'done' : 'form'); }
        else setState('invalid');
      } catch { setState('invalid'); }
    })();
  }, [token]);

  const submit = async () => {
    if (score === null) { setErr('Score select karein (0–10)'); return; }
    setErr('');
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || '';
      const r = await fetch(`${base}/api/onboarding-feedback/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment.trim() || undefined }),
      });
      const d = await r.json();
      if (r.ok) setState('done');
      else setErr(d.error || 'Submit nahi ho saka');
    } catch { setErr('Network error — dobara koshish karein'); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-4">
      <div className="card-premium w-full max-w-md p-8 text-center">
        {state === 'loading' && <p className="text-slate-300">Loading…</p>}
        {state === 'invalid' && <>
          <h1 className="text-2xl font-extrabold text-white mb-2">Invalid link</h1>
          <p className="text-sm text-slate-400">Ye survey link ghalat ya expire ho chuka hai.</p>
        </>}
        {state === 'done' && <>
          <h1 className="text-2xl font-extrabold text-white mb-2">Shukriya! 🙏</h1>
          <p className="text-sm text-slate-400">Aap ka feedback mil gaya hai.</p>
        </>}
        {state === 'form' && <>
          <p className="text-xs text-slate-500 mb-1">{meta?.tenantName || 'Techub'}</p>
          <h1 className="text-xl font-extrabold text-white mb-1">Salam {meta?.firstName || 'Member'}! 👋</h1>
          <p className="text-sm text-slate-400 mb-6">Aap ko 30 din ho gaye hain — kya aap {meta?.tenantName || 'hamen'} doston ko recommend karenge?</p>
          <div className="grid grid-cols-11 gap-1 mb-4">
            {Array.from({ length: 11 }, (_, i) => (
              <button key={i} onClick={() => setScore(i)}
                className={`py-2 rounded-lg text-sm font-bold transition ${score === i ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                {i}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 mb-4">
            <span>Bilkul nahi</span><span>Zaroor</span>
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
            placeholder="Koi tajweez? (optional)"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 mb-4" />
          {err && <p className="text-red-400 text-xs mb-3">{err}</p>}
          <button onClick={submit} className="btn-primary w-full py-2.5 rounded-xl font-bold">Submit Feedback</button>
        </>}
      </div>
    </div>
  );
}
