'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

const CATS = [
  { v: 'suggestion', l: '💡 Suggestion' },
  { v: 'complaint', l: '⚠️ Complaint' },
  { v: 'praise', l: '👏 Praise' },
  { v: 'facility', l: '🏢 Facility' },
  { v: 'service', l: '🛎️ Service' },
  { v: 'staff', l: '🧑‍💼 Staff' },
  { v: 'cleanliness', l: '🧹 Cleanliness' },
  { v: 'other', l: '💬 Other' },
];

const STATUS_COLOR = { new: 'amber', reviewed: 'blue', planned: 'violet', done: 'green', rejected: 'red', resolved: 'green' };

function FeedbackCard({ f, onUpvote, upvoting }) {
  return (
    <div className="card-premium p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge color={STATUS_COLOR[f.status] || 'slate'}>{f.status}</Badge>
          <span className="text-xs text-slate-500">{f.category}</span>
        </div>
        <button
          onClick={() => onUpvote(f.id)}
          disabled={upvoting === f.id}
          className={`flex items-center gap-1 text-xs rounded-full px-3 py-1.5 border transition ${
            f.upvotedByMe
              ? 'bg-[#8b5cf6]/20 border-[#8b5cf6]/40 text-[#ddd6fe]'
              : 'bg-white/5 border-white/10 text-slate-300 hover:border-[#8b5cf6]/40'
          }`}
        >
          👍 {f.upvotes || 0}
        </button>
      </div>
      {f.title && <p className="text-white font-semibold text-sm mb-1">{f.title}</p>}
      <p className="text-sm text-slate-200 whitespace-pre-wrap">{f.body}</p>
      <p className="text-xs text-slate-500 mt-2">
        {f.isAnonymous ? '🕵️ Anonymous' : `👤 ${f.member?.name || 'Member'}`} • {new Date(f.createdAt).toLocaleString()}
      </p>
      {f.adminReply && (
        <div className="mt-3 p-3 rounded-lg bg-[#8b5cf6]/10 border border-[#8b5cf6]/20">
          <p className="text-xs font-semibold text-[#c4b5fd] mb-1">Admin reply:</p>
          <p className="text-sm text-slate-200 whitespace-pre-wrap">{f.adminReply}</p>
        </div>
      )}
    </div>
  );
}

export default function PortalFeedbackPage() {
  const [tab, setTab] = useState('board'); // board | mine | new
  const [board, setBoard] = useState([]);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('suggestion');
  const [body, setBody] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [upvoting, setUpvoting] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/feedback/board').then((d) => setBoard(d.items || [])).catch(() => {}),
      api.get('/feedback/mine').then((d) => setMine(d.items || [])).catch((e) => setError(e.message)),
    ]).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.post('/feedback', {
        category, title: title.trim() || null, body: body.trim(), isAnonymous,
      });
      setTitle('');
      setBody('');
      setIsAnonymous(false);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
      load();
      setTab('board');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const upvote = async (id) => {
    setUpvoting(id);
    try {
      await api.post(`/feedback/${id}/upvote`);
      const d = await api.get('/feedback/board');
      setBoard(d.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setUpvoting(null);
    }
  };

  return (
    <div>
      <PageHeader title="Feedback" subtitle="Apni raye dein — hum behtar banayenge" />

      <div className="flex gap-2 mb-6">
        {[
          { v: 'board', l: '🗳️ Suggestions Board' },
          { v: 'mine', l: '📝 My Feedback' },
          { v: 'new', l: '➕ New' },
        ].map((t) => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            className={`text-sm rounded-full px-4 py-2 border transition ${
              tab === t.v
                ? 'bg-[#8b5cf6]/20 border-[#8b5cf6]/40 text-[#ddd6fe]'
                : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/25'
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      {tab === 'new' && (
        <div className="card-premium p-6 mb-6 max-w-2xl">
          <h2 className="text-lg font-bold text-white mb-4">Naya feedback</h2>
          {done && <div className="mb-4 text-sm text-emerald-300">✅ Shukriya! Aap ka feedback mil gaya.</div>}
          <form onSubmit={submit}>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Category</label>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Title (optional)</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mukhtasar unwan…" maxLength={200} />
            </div>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Details</label>
              <textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Apni tajweez ya shikayat likhein…" required />
            </div>
            <label className="flex items-center gap-3 mb-5 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={isAnonymous}
                onClick={() => setIsAnonymous(!isAnonymous)}
                className={`w-11 h-6 rounded-full relative transition-colors ${isAnonymous ? 'bg-[#8b5cf6]' : 'bg-white/10'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${isAnonymous ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
              <span className="text-sm text-slate-300">🕵️ Anonymous bhejein (naam zahir nahi hoga)</span>
            </label>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? 'Bhej rahe hain…' : 'Submit Feedback'}
            </button>
          </form>
        </div>
      )}

      {tab === 'board' && (
        <div>
          <h2 className="text-lg font-bold text-white mb-3">Community suggestions</h2>
          <p className="text-sm text-slate-400 mb-4">Members ki tajaveez — achi lage to 👍 upvote karein.</p>
          {loading ? <Spinner /> : board.length === 0 ? (
            <EmptyState title="Abhi koi suggestion nahi" />
          ) : (
            <div className="space-y-3 max-w-2xl">
              {board.map((f) => <FeedbackCard key={f.id} f={f} onUpvote={upvote} upvoting={upvoting} />)}
            </div>
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div>
          <h2 className="text-lg font-bold text-white mb-3">Mera feedback</h2>
          {loading ? <Spinner /> : mine.length === 0 ? (
            <EmptyState title="Abhi koi feedback nahi" />
          ) : (
            <div className="space-y-3 max-w-2xl">
              {mine.map((f) => <FeedbackCard key={f.id} f={f} onUpvote={upvote} upvoting={upvoting} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
