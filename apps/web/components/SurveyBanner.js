'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Member portal: pending NPS survey banner with quick 0-10 score + comment.
export default function SurveyBanner() {
  const [pending, setPending] = useState([]);
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/surveys/active')
      .then((d) => setPending(d.pending || []))
      .catch(() => {});
  }, []);

  if (pending.length === 0 || done) return null;
  const survey = pending[0];

  async function submit(e) {
    e.preventDefault();
    if (score === null) {
      setError('Please pick a score from 0 to 10.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.post(`/surveys/${survey.id}/respond`, { score, comment: comment.trim() || undefined });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Submit failed');
      setBusy(false);
    }
  }

  const scoreColor = (s) => (s >= 9 ? '#34d399' : s >= 7 ? '#fbbf24' : '#f87171');

  return (
    <div className="card-premium p-5 mb-3 border !border-teal-200" style={{ boxShadow: '0 0 24px rgba(15,118,110,0.15)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-gray-900 font-bold">📋 {survey.title}</h2>
          <p className="text-gray-500 text-sm mt-1">
            How likely are you to recommend us to a friend or colleague? (0 = not at all, 10 = extremely likely)
          </p>
        </div>
        {pending.length > 1 && (
          <span className="text-xs text-gray-500 whitespace-nowrap">+{pending.length - 1} more</span>
        )}
      </div>
      <form onSubmit={submit}>
        <div className="flex flex-wrap gap-2 mb-3">
          {Array.from({ length: 11 }, (_, s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScore(s)}
              className={`w-10 h-10 rounded-xl text-sm font-bold transition-all ${
                score === s ? 'scale-110 ring-2 ring-white/60' : 'opacity-70 hover:opacity-100'
              }`}
              style={{ background: `${scoreColor(s)}22`, border: `1px solid ${scoreColor(s)}66`, color: scoreColor(s) }}
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          className="input mb-3"
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anything you'd like to add? (optional)"
          maxLength={2000}
        />
        {error && <p className="text-sm text-red-700 mb-3">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Submitting…' : 'Submit Response'}
          </button>
        </div>
      </form>
    </div>
  );
}
