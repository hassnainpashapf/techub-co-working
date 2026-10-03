'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

const CATS = [
  { v: 'facility', l: '🏢 Facility' },
  { v: 'service', l: '🛎️ Service' },
  { v: 'staff', l: '🧑‍💼 Staff' },
  { v: 'cleanliness', l: '🧹 Cleanliness' },
  { v: 'other', l: '💬 Other' },
];

const STATUS_COLOR = { new: 'amber', reviewed: 'blue', resolved: 'green' };

export default function PortalFeedbackPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(5);
  const [category, setCategory] = useState('other');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/feedback/mine')
      .then((d) => setItems(d.items || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.post('/feedback', { category, rating, message: message.trim() });
      setMessage('');
      setRating(5);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader title="Feedback" subtitle="Apni raye dein — hum behtar banayenge" />

      <div className="card-premium p-6 mb-6 max-w-2xl">
        <h2 className="text-lg font-bold text-white mb-4">Naya feedback</h2>
        {error && <ErrorBanner message={error} />}
        {done && <div className="mb-4 text-sm text-emerald-300">✅ Shukriya! Aap ka feedback mil gaya.</div>}
        <form onSubmit={submit}>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-300 mb-2">Rating</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className={`text-3xl transition-transform hover:scale-110 ${n <= rating ? '' : 'grayscale opacity-40'}`}
                  aria-label={`${n} stars`}
                >
                  ⭐
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Message</label>
            <textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Apna tajurba likhein…" required />
          </div>
          <button type="submit" className="btn-primary" disabled={sending}>
            {sending ? 'Bhej rahe hain…' : 'Submit Feedback'}
          </button>
        </form>
      </div>

      <h2 className="text-lg font-bold text-white mb-3">Mera feedback</h2>
      {loading ? <Spinner /> : items.length === 0 ? (
        <EmptyState title="Abhi koi feedback nahi" />
      ) : (
        <div className="space-y-3 max-w-2xl">
          {items.map((f) => (
            <div key={f.id} className="card-premium p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">{'⭐'.repeat(f.rating)}</span>
                <Badge color={STATUS_COLOR[f.status] || 'slate'}>{f.status}</Badge>
              </div>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{f.message}</p>
              {f.adminReply && (
                <div className="mt-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <p className="text-xs font-semibold text-blue-300 mb-1">Admin reply:</p>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{f.adminReply}</p>
                </div>
              )}
              <p className="text-xs text-slate-500 mt-2">{new Date(f.createdAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
