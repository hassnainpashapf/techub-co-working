'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, StatCard } from '../../../../components/ui';

const STATUS_COLOR = { draft: 'slate', open: 'green', closed: 'amber' };

function ResultsBars({ results }) {
  if (!results) return null;
  const max = Math.max(1, ...results.breakdown.map((b) => b.votes));
  return (
    <div className="mt-3 space-y-2">
      {results.breakdown.map((b) => (
        <div key={b.optionId}>
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>{b.text}</span>
            <span className="text-gray-500">
              {b.votes} vote{b.votes === 1 ? '' : 's'}
              {b.percent !== undefined ? ` • ${b.percent}%` : ''}
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#0f766e] to-teal-600 transition-all"
              style={{ width: `${(b.votes / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">Total: {results.totalVotes} votes</p>
    </div>
  );
}

function CreateModal({ onClose, onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [closesAt, setClosesAt] = useState('');
  const [openNow, setOpenNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const texts = options.map((t) => t.trim()).filter(Boolean);
    if (question.trim().length < 3) return setErr('Question is too short.');
    if (texts.length < 2) return setErr('At least 2 options are required.');
    setSaving(true);
    try {
      await api.post('/polls', {
        question: question.trim(),
        options: texts.map((text) => ({ text })),
        closesAt: closesAt || null,
        openNow,
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error?.message || 'Failed to create poll.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="card-premium p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-gray-900 font-semibold mb-4">New poll</h3>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-500">Question</label>
            <input className="input mt-1" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should we improve first?" maxLength={500} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Options (2–10)</label>
            {options.map((t, i) => (
              <div key={i} className="flex gap-2 mt-2">
                <input
                  className="input"
                  value={t}
                  onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={`Option ${i + 1}`}
                  maxLength={200}
                />
                {options.length > 2 && (
                  <button type="button" className="btn-ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))}>✕</button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => setOptions([...options, ''])}>+ Add option</button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">Closes at (optional)</label>
              <input type="datetime-local" className="input mt-1" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 pt-5">
              <input type="checkbox" checked={openNow} onChange={(e) => setOpenNow(e.target.checked)} /> Open immediately
            </label>
          </div>
          {err && <ErrorBanner message={err} />}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create poll'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PollsPage() {
  const [polls, setPolls] = useState([]);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/polls');
      setPolls(data.polls || []);
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Failed to load polls.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadResults = async (id) => {
    try {
      const { data } = await api.get(`/polls/${id}/results`);
      setResults((r) => ({ ...r, [id]: data }));
    } catch {}
  };

  const act = async (id, action) => {
    try {
      if (action === 'delete' && !window.confirm('Delete this poll and all its votes?')) return;
      if (action === 'delete') await api.delete(`/polls/${id}`);
      else await api.post(`/polls/${id}/${action}`);
      load();
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Action failed.');
    }
  };

  const openCount = polls.filter((p) => p.status === 'open').length;
  const closedCount = polls.filter((p) => p.status === 'closed').length;
  const totalVotes = polls.reduce((s, p) => s + (p.totalVotes || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Community Polls"
        subtitle="Ask members, get real answers"
        action={<button className="btn-primary" onClick={() => setShowCreate(true)}>+ New poll</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Open polls" value={openCount} icon="🗳️" />
        <StatCard label="Closed" value={closedCount} icon="📦" />
        <StatCard label="Total votes" value={totalVotes} icon="📊" />
      </div>
      {loading ? <Spinner /> : polls.length === 0 ? (
        <EmptyState icon="🗳️" title="No polls yet" text="Create the first poll to hear your community." />
      ) : (
        <div className="grid gap-4">
          {polls.map((p) => (
            <div key={p.id} className="card-premium p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-gray-900 font-semibold">{p.question}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge color={STATUS_COLOR[p.status]}>{p.status}</Badge>
                    <span className="text-xs text-slate-500">
                      {p.totalVotes} votes{p.closesAt ? ` • closes ${new Date(p.closesAt).toLocaleString()}` : ''}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="btn-ghost text-xs" onClick={() => loadResults(p.id)}>Results</button>
                  {p.status === 'draft' && <button className="btn-ghost text-xs" onClick={() => act(p.id, 'open')}>Open</button>}
                  {p.status === 'open' && <button className="btn-ghost text-xs" onClick={() => act(p.id, 'close')}>Close</button>}
                  <button className="btn-ghost text-xs text-red-700" onClick={() => act(p.id, 'delete')}>Delete</button>
                </div>
              </div>
              {results[p.id] && <ResultsBars results={results[p.id]} />}
            </div>
          ))}
        </div>
      )}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}
