'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const SEV_STYLE = {
  critical: 'border-red-500/40 bg-red-500/10',
  warning: 'border-amber-500/40 bg-amber-500/10',
  info: 'border-[#0f766e]/40 bg-[#0f766e]/10',
};
const SEV_DOT = { critical: 'bg-red-400', warning: 'bg-amber-400', info: 'bg-[#0f766e]' };
const SEV_ICON = { critical: '🔴', warning: '⚠️', info: 'ℹ️' };

function Donut({ positive, neutral, negative }) {
  const total = positive + neutral + negative;
  if (!total) return <EmptyState title="Koi feedback nahi" />;
  const r = 54;
  const c = 2 * Math.PI * r;
  const segs = [
    { v: positive, color: '#34d399' },
    { v: neutral, color: '#60a5fa' },
    { v: negative, color: '#f87171' },
  ];
  let off = 0;
  return (
    <div className="flex items-center gap-6">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="18" />
        {segs.map((s, i) => {
          const len = (s.v / total) * c;
          const el = <circle key={i} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="18"
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
          off += len;
          return el;
        })}
        <text x="70" y="70" textAnchor="middle" dominantBaseline="middle" className="fill-white text-xl font-bold">{total}</text>
      </svg>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-400" /> Positive — {positive}</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#0f766e]" /> Neutral — {neutral}</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-400" /> Negative — {negative}</div>
      </div>
    </div>
  );
}

export default function IntelligencePage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [readIds, setReadIds] = useState(new Set());

  const load = async () => {
    try {
      setLoading(true);
      const r = await api.get('/api/intelligence/overview');
      setData(r.data || {});
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Intelligence load nahi ho saki');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  const markRead = async (id) => {
    setReadIds((p) => new Set(p).add(id));
    try {
      await api.patch(`/api/intelligence/insights/${id}/read`);
    } catch {
      // track 4 ka route merge na ho to silent — UI se to hat gaya
    }
  };

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const insights = data?.insights || {};
  const anomalies = data?.anomalies || {};
  const sentiment = data?.sentiment || {};
  const pricing = data?.pricing || {};
  const visibleInsights = (insights.items || []).filter((i) => !readIds.has(i.id));
  const attn = (insights.unreadCount || 0) + (anomalies.items || []).length + (sentiment.negative || 0);

  return (
    <div className="space-y-6">
      <PageHeader title="🧠 Intelligence" subtitle="AI insights, anomalies, sentiment aur pricing hints — sab ek jagah" />

      {err && <ErrorBanner message={err} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Unread Insights" value={insights.available ? insights.unreadCount : '—'} icon="💡" />
        <StatCard title="Anomalies (30d)" value={(anomalies.items || []).length} icon="🚨" />
        <StatCard title="Negative Feedback" value={sentiment.available ? sentiment.negative : '—'} icon="😟" />
        <StatCard title="Pricing Hints" value={pricing.available ? pricing.count : '—'} icon="💰" />
      </div>

      {attn > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
          ⚡ {attn} cheezein tawajjo mangti hain — neeche details dekho.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Insights */}
        <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">💡 Weekly Insights</h3>
          {!insights.available ? (
            <p className="text-gray-500 text-sm">Insights engine abhi merge nahi hua.</p>
          ) : visibleInsights.length === 0 ? (
            <EmptyState title="Sab clear — koi unread insight nahi" />
          ) : (
            <div className="space-y-3">
              {visibleInsights.map((i) => (
                <div key={i.id} className={`rounded-xl border p-4 ${SEV_STYLE[i.severity] || SEV_STYLE.info}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${SEV_DOT[i.severity] || SEV_DOT.info}`} />
                      <span className="font-medium text-gray-900">{i.title}</span>
                      <Badge>{i.type}</Badge>
                    </div>
                    <button onClick={() => markRead(i.id)}
                      className="text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-2 py-1">
                      ✓ Parh liya
                    </button>
                  </div>
                  <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{i.body}</p>
                  <p className="text-xs text-slate-500 mt-2">{fmtDate(i.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Anomalies */}
        <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">🚨 Anomaly Alerts</h3>
          {(anomalies.items || []).length === 0 ? (
            <EmptyState title="Pichle 30 din me koi anomaly nahi" />
          ) : (
            <div className="space-y-3">
              {anomalies.items.map((a) => (
                <div key={a.id} className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                  <div className="font-medium text-gray-900">{SEV_ICON[a.severity] || '🚨'} {a.title || 'Anomaly'}</div>
                  <p className="text-sm text-gray-600 mt-1">{a.detail || a.message}</p>
                  <p className="text-xs text-slate-500 mt-2">{fmtDate(a.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sentiment */}
        <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">😊 Feedback Sentiment</h3>
          {!sentiment.available ? (
            <p className="text-gray-500 text-sm">Feedback module available nahi.</p>
          ) : (
            <>
              <Donut positive={sentiment.positive} neutral={sentiment.neutral} negative={sentiment.negative} />
              {sentiment.source === 'rating' && (
                <p className="text-xs text-slate-500 mt-3">Rating se andaza (sentiment engine merge ke baad asal scores).</p>
              )}
              {(sentiment.recent || []).length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium text-red-300">Action needed — negative feedback:</p>
                  {sentiment.recent.map((f) => (
                    <div key={f.id} className="rounded-lg border border-gray-200 bg-gray-100 p-3 text-sm">
                      <div className="text-gray-900 font-medium">{f.title || 'Untitled'} <span className="text-gray-500">★{f.rating}</span></div>
                      <p className="text-gray-500 line-clamp-2">{f.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pricing hints */}
        <div className="rounded-2xl border border-gray-200 bg-gray-100 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">💰 Smart Pricing Hints</h3>
          {!pricing.available ? (
            <p className="text-gray-500 text-sm">Pricing data available nahi.</p>
          ) : (pricing.hints || []).length === 0 ? (
            <EmptyState title="Koi pricing hint nahi — sab theek hai" />
          ) : (
            <div className="space-y-3">
              {(pricing.hints || []).map((h, i) => (
                <div key={i} className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {h.action === 'raise' ? '📈 Barhao' : h.action === 'lower' ? '📉 Kam karo' : '🎁 Promo lagao'}
                    </span>
                    <Badge>{h.scope === 'type' ? 'Unit type' : 'Unit'}: {h.ref}</Badge>
                    {h.pct ? <span className="text-emerald-300 text-sm">~{h.pct}%</span> : null}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{h.reason}</p>
                  <p className="text-xs text-slate-500 mt-1">Sirf mashwara — price auto change nahi hoti.</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
