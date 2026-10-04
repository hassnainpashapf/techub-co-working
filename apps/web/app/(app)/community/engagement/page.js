'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, ErrorBanner, Spinner, EmptyState, DataTable, Modal, Field } from '../../../../components/ui';

const TIER_META = {
  champion: { label: 'Champions', color: '#22c55e', bg: 'bg-green-500/15 text-green-300 border-green-500/30' },
  active: { label: 'Active', color: '#0f766e', bg: 'bg-[#0f766e]/15 text-teal-700 border-[#0f766e]/30' },
  casual: { label: 'Casual', color: '#f59e0b', bg: 'bg-amber-500/15 text-amber-700 border-amber-200' },
  'at-risk': { label: 'At-risk', color: '#ef4444', bg: 'bg-red-500/15 text-red-700 border-red-200' },
};

function TierPill({ tier }) {
  const m = TIER_META[tier] || {};
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${m.bg || 'bg-slate-500/15 text-gray-600'}`}>
      {m.label || tier}
    </span>
  );
}

function ScoreBar({ score }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-sm font-bold text-gray-900 w-8 text-right">{score}</span>
    </div>
  );
}

function Donut({ distribution, total }) {
  const R = 70, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = Object.entries(distribution).filter(([, v]) => v > 0);
  return (
    <div className="flex items-center gap-6">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="22" />
        {segs.map(([tier, v]) => {
          const frac = v / Math.max(1, total);
          const el = (
            <circle
              key={tier}
              cx="90" cy="90" r={R} fill="none"
              stroke={TIER_META[tier].color}
              strokeWidth="22"
              strokeDasharray={`${frac * C} ${C}`}
              strokeDashoffset={-acc * C}
              strokeLinecap="butt"
              transform="rotate(-90 90 90)"
            />
          );
          acc += frac;
          return el;
        })}
        <text x="90" y="84" textAnchor="middle" fill="#111827" fontSize="28" fontWeight="800">{total}</text>
        <text x="90" y="106" textAnchor="middle" fill="rgba(0,0,0,0.6)" fontSize="12">members</text>
      </svg>
      <div className="space-y-2">
        {segs.map(([tier, v]) => (
          <div key={tier} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full" style={{ background: TIER_META[tier].color }} />
            <span className="text-gray-700">{TIER_META[tier].label}</span>
            <span className="text-gray-900 font-bold ml-auto pl-4">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EngagementPage() {
  const [tier, setTier] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mailFor, setMailFor] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState('');

  const load = async (t) => {
    setLoading(true); setError('');
    try {
      const res = await api.get(`/engagement${t ? `?tier=${t}` : ''}`);
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load engagement');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(tier); }, [tier]);

  const sendRetention = async () => {
    if (!mailFor) return;
    setSending(true);
    try {
      await api.post('/engagement/retention-offer', { memberId: mailFor.id, message });
      setSentOk(`${mailFor.name} ko retention email bhej di`);
      setMailFor(null); setMessage('');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to send');
    } finally { setSending(false); }
  };

  const atRisk = (data?.members || []).filter((m) => m.tier === 'at-risk');
  const champions = (data?.members || []).filter((m) => m.tier === 'champion').slice(0, 5);
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Member Engagement"
        sub="Kon kitna active hai — bookings, events, feedback, referrals, logins"
        actions={
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setTier('')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${!tier ? 'bg-[#0f766e] text-white shadow-[0_0_12px_rgba(37,99,235,0.5)]' : 'bg-gray-100 text-gray-600 hover:bg-slate-700'}`}
            >All</button>
            {Object.entries(TIER_META).map(([k, m]) => (
              <button
                key={k}
                onClick={() => setTier(k)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${tier === k ? 'bg-[#0f766e] text-white shadow-[0_0_12px_rgba(37,99,235,0.5)]' : 'bg-gray-100 text-gray-600 hover:bg-slate-700'}`}
              >{m.label}</button>
            ))}
          </div>
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => load(tier)} />}
      {sentOk && (
        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-300 text-sm flex justify-between items-center">
          <span>{sentOk}</span>
          <button onClick={() => setSentOk('')} className="text-green-300/60 hover:text-green-300">✕</button>
        </div>
      )}

      {loading ? <Spinner /> : !summary ? (
        <EmptyState title="No data" hint="Members milne par engagement scores yahan dikhenge" />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Avg Score" value={summary.avgScore} sub={`${summary.total} members`} accent="blue" />
            <StatCard label="Champions" value={summary.championCount} sub="80+ score" accent="green" />
            <StatCard label="At-risk" value={summary.atRiskCount} sub="40 se kam — action lo" accent="red" />
            <StatCard label="Active" value={summary.distribution.active} sub="60-79 score" accent="amber" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <h3 className="text-gray-900 font-bold mb-4">Tier Distribution</h3>
              <Donut distribution={summary.distribution} total={summary.total} />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <h3 className="text-gray-900 font-bold mb-4">Top Champions 🏆</h3>
              {champions.length === 0 ? (
                <EmptyState title="Koi champion nahi" hint="80+ score wale members yahan dikhenge" />
              ) : (
                <div className="space-y-3">
                  {champions.map((m, i) => (
                    <div key={m.id} className="flex items-center gap-3">
                      <span className="text-lg font-extrabold text-gray-900/40 w-6">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-900 font-semibold truncate">{m.name}</div>
                        <div className="text-xs text-gray-900/50 truncate">{m.companyName || m.email || ''}</div>
                      </div>
                      <ScoreBar score={m.score} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-gray-900 font-bold mb-3">At-risk Members <span className="text-red-400">({atRisk.length})</span></h3>
            <DataTable
              columns={[
                { key: 'name', label: 'Member', render: (r) => (
                  <div><div className="font-semibold">{r.name}</div><div className="text-xs text-gray-900/50">{r.email || r.phone || ''}</div></div>
                )},
                { key: 'score', label: 'Score', render: (r) => <ScoreBar score={r.score} /> },
                { key: 'tier', label: 'Tier', render: (r) => <TierPill tier={r.tier} /> },
                { key: 'lastActivityAt', label: 'Last Activity', render: (r) => (
                  <span className="text-gray-600 text-sm">{r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleDateString() : '—'}</span>
                )},
                { key: 'breakdown', label: 'Why', render: (r) => (
                  <span className="text-gray-500 text-xs">{(r.breakdown || []).filter((b) => b.points > 0).slice(0, 2).map((b) => b.label).join(' • ') || 'Koi engagement signal nahi'}</span>
                )},
                { key: 'action', label: 'Action', render: (r) => (
                  <button
                    onClick={() => setMailFor(r)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0f766e] text-white hover:bg-[#0f766e] shadow-[0_0_12px_rgba(37,99,235,0.4)]"
                  >Send retention email</button>
                )},
              ]}
              rows={atRisk}
              empty={{ title: 'Koi at-risk member nahi 🎉', hint: 'Sab members 40+ score par hain' }}
            />
          </div>
        </>
      )}

      {mailFor && (
        <Modal title={`Retention email — ${mailFor.name}`} onClose={() => setMailFor(null)}>
          <Field label="Custom message (optional)">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="e.g. Hum ne apke liye 20% loyalty bonus rakha hai..."
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-[#0f766e]"
            />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setMailFor(null)} className="px-4 py-2 rounded-full text-sm bg-gray-100 text-gray-600 hover:bg-slate-700">Cancel</button>
            <button
              onClick={sendRetention}
              disabled={sending}
              className="px-4 py-2 rounded-full text-sm bg-[#0f766e] text-white font-semibold hover:bg-[#0f766e] disabled:opacity-50"
            >{sending ? 'Bhej raha...' : 'Send email'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
