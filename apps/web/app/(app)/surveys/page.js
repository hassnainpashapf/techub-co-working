'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  StatCard,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
  EmptyState,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toISOString().slice(0, 10);
}

const STATUS_TONE = { draft: 'slate', active: 'emerald', closed: 'amber' };

// Semicircle NPS gauge (-100..100)
function NpsGauge({ nps }) {
  const v = nps === null || nps === undefined ? 0 : nps;
  const angle = ((v + 100) / 200) * 180; // 0..180
  const r = 70;
  const rad = ((180 - angle) * Math.PI) / 180;
  const x = 80 + r * Math.cos(rad);
  const y = 80 - r * Math.sin(rad);
  const color = v >= 50 ? '#34d399' : v >= 0 ? '#fbbf24' : '#f87171';
  return (
    <svg viewBox="0 0 160 95" className="w-44 h-24">
      <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="14" strokeLinecap="round" />
      <path
        d="M 10 80 A 70 70 0 0 1 150 80"
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${(angle / 180) * 219.9} 220`}
        style={{ filter: `drop-shadow(0 0 8px ${color})` }}
      />
      <line x1="80" y1="80" x2={x} y2={y} stroke={color} strokeWidth="3" strokeLinecap="round" />
      <circle cx="80" cy="80" r="6" fill={color} />
      <text x="80" y="70" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800">
        {nps === null || nps === undefined ? '—' : v}
      </text>
    </svg>
  );
}

function ScoreBars({ distribution }) {
  const max = Math.max(1, ...Object.values(distribution || {}));
  return (
    <div className="flex items-end gap-1 h-28">
      {Object.keys(distribution || {})
        .map(Number)
        .sort((a, b) => a - b)
        .map((s) => {
          const c = distribution[s];
          const h = Math.max(4, (c / max) * 100);
          const color = s >= 9 ? '#34d399' : s >= 7 ? '#fbbf24' : '#f87171';
          return (
            <div key={s} className="flex-1 flex flex-col items-center justify-end h-full" title={`Score ${s}: ${c}`}>
              <span className="text-[10px] text-gray-600 mb-1">{c}</span>
              <div className="w-full rounded-t" style={{ height: `${h}%`, background: color, opacity: 0.85 }} />
              <span className="text-[10px] text-slate-500 mt-1">{s}</span>
            </div>
          );
        })}
    </div>
  );
}

function CreateSurveyModal({ onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('draft');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/surveys', { title, type: 'nps', status });
      onDone();
    } catch (err) {
      setError(err.message || 'Create failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="New NPS Survey" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Monthly NPS — October" maxLength={200} />
        </Field>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="active">Active (members can respond)</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Creating…' : 'Create Survey'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResultsView({ survey, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/surveys/${survey.id}/results`)
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load results'))
      .finally(() => setLoading(false));
  }, [survey.id]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { stats, comments } = data;

  return (
    <div>
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-900 mb-4">← Back to surveys</button>
      <PageHeader title={data.survey.title} sub={`${fmtDate(survey.createdAt)} • ${data.survey.status}`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Responses" value={stats.responses} accent="blue" />
        <StatCard label="Promoters (9-10)" value={stats.promoters} accent="emerald" />
        <StatCard label="Detractors (0-6)" value={stats.detractors} accent="red" />
        <StatCard label="Passives (7-8)" value={stats.passives} accent="amber" />
      </div>
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card-premium p-5 flex flex-col items-center">
          <h2 className="text-gray-900 font-bold mb-2 self-start">NPS Score</h2>
          <NpsGauge nps={stats.nps} />
          <p className="text-xs text-slate-500 mt-2">% Promoters − % Detractors (−100 … +100)</p>
        </div>
        <div className="card-premium p-5">
          <h2 className="text-gray-900 font-bold mb-4">Score Distribution</h2>
          <ScoreBars distribution={stats.distribution} />
        </div>
      </div>
      <div className="card-premium p-5">
        <h2 className="text-gray-900 font-bold mb-4">Comments ({comments.length})</h2>
        {comments.length === 0 ? (
          <p className="text-gray-500 text-sm">No comments yet.</p>
        ) : (
          <div className="space-y-3">
            {comments.map((c, i) => (
              <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-900 text-sm font-medium">{c.memberName}</span>
                  <Badge tone={c.score >= 9 ? 'emerald' : c.score >= 7 ? 'amber' : 'red'}>{c.score}/10</Badge>
                  <span className="text-slate-500 text-xs ml-auto">{fmtDate(c.createdAt)}</span>
                </div>
                <p className="text-gray-600 text-sm">{c.comment}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SurveysPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get('/surveys');
      setSurveys(d.surveys || []);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  async function setStatus(survey, status) {
    if (!confirm(`Mark "${survey.title}" as ${status}?`)) return;
    setBusy(survey.id);
    try {
      await api.patch(`/surveys/${survey.id}`, { status });
      await load();
    } catch (e) {
      alert(e.message || 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  if (allowed === null) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!allowed) return <AccessDenied />;
  if (viewing) return <ResultsView survey={viewing} onBack={() => { setViewing(null); load(); }} />;

  return (
    <div>
      <PageHeader
        title="NPS Surveys"
        sub="Measure member loyalty — Net Promoter Score"
        actions={<button onClick={() => setShowCreate(true)} className="btn-primary">+ New Survey</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : surveys.length === 0 ? (
        <EmptyState title="No surveys yet" hint="Create your first NPS survey to start collecting member feedback." />
      ) : (
        <DataTable
          columns={[
            { key: 'title', label: 'Title' },
            { key: 'status', label: 'Status', render: (s) => <Badge tone={STATUS_TONE[s.status] || 'slate'}>{s.status}</Badge> },
            { key: 'responses', label: 'Responses', render: (s) => s._count?.responses ?? 0 },
            { key: 'createdAt', label: 'Created', render: (s) => fmtDate(s.createdAt) },
            {
              key: 'actions',
              label: 'Actions',
              render: (s) => (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setViewing(s)} className="text-xs text-teal-700 hover:text-teal-700 underline">Results</button>
                  {s.status === 'draft' && (
                    <button onClick={() => setStatus(s, 'active')} disabled={busy === s.id} className="text-xs text-emerald-300 hover:text-emerald-200 underline">Activate</button>
                  )}
                  {s.status === 'active' && (
                    <button onClick={() => setStatus(s, 'closed')} disabled={busy === s.id} className="text-xs text-amber-300 hover:text-amber-200 underline">Close</button>
                  )}
                </div>
              ),
            },
          ]}
          rows={surveys}
        />
      )}
      {showCreate && <CreateSurveyModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}
