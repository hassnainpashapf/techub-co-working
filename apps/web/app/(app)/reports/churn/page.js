'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import {
  PageHeader,
  DataTable,
  StatCard,
  Spinner,
  ErrorBanner,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';
import { HDBarChart } from '../../../../components/charts';

function riskColor(score) {
  if (score >= 60) return '#f87171';
  if (score >= 40) return '#fb923c';
  return '#fbbf24';
}

function RiskBar({ score }) {
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: riskColor(score) }}
        />
      </div>
      <span className="text-sm font-bold w-8 text-right" style={{ color: riskColor(score) }}>
        {score}
      </span>
    </div>
  );
}

const REASON_STYLES = {
  overdue_invoices: 'border-red-400/40 bg-red-500/15 text-red-200',
  no_recent_bookings: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
  no_recent_attendance: 'border-orange-400/40 bg-orange-500/15 text-orange-200',
  contract_expiring: 'border-teal-500/40 bg-teal-600/15 text-violet-200',
  nps_detractor: 'border-pink-400/40 bg-pink-500/15 text-pink-200',
};

function OfferModal({ member, onClose, onSent }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setSending(true);
    setError('');
    try {
      await api.post('/churn/retention-offer', { memberId: member.memberId, message });
      onSent();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="card-premium w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 mb-1">Send retention offer</h3>
        <p className="text-sm text-gray-500 mb-4">
          To: <span className="text-gray-900 font-medium">{member.memberName}</span>
          {member.email ? <span className="text-slate-500"> ({member.email})</span> : ' — no email on file'}
        </p>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Personal message (optional)
        </label>
        <textarea
          className="input min-h-[100px]"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. We'd like to offer you 10% off your next month…"
        />
        {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={send} disabled={sending || !member.email}>
            {sending ? 'Sending…' : '📧 Send offer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChurnPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [offerFor, setOfferFor] = useState(null);
  const [sentMsg, setSentMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get('/churn');
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;

  const atRisk = data.atRisk || [];

  const columns = [
    { key: 'memberName', label: 'Member', render: (r) => (
      <div>
        <div className="font-medium text-gray-900">{r.memberName}</div>
        <div className="text-xs text-slate-500">{r.companyName || r.status}</div>
      </div>
    )},
    { key: 'riskScore', label: 'Risk score', render: (r) => <RiskBar score={r.riskScore} /> },
    { key: 'reasons', label: 'Reasons', render: (r) => (
      <div className="flex flex-wrap gap-1.5 max-w-[320px]">
        {r.reasons.map((reason) => (
          <span
            key={reason.code}
            title={reason.detail || reason.label}
            className={`text-xs px-2 py-0.5 rounded-full border ${REASON_STYLES[reason.code] || 'border-slate-400/40 bg-slate-500/15 text-gray-800'}`}
          >
            {reason.label}{reason.detail ? ` — ${reason.detail}` : ''}
          </span>
        ))}
      </div>
    )},
    { key: 'actions', label: '', render: (r) => (
      <button className="btn-sm btn-ghost" onClick={() => setOfferFor(r)}>
        📧 Send offer
      </button>
    )},
  ];

  return (
    <div>
      <PageHeader title="Churn Analysis" subtitle="Exit rate, trend and at-risk members" />

      {sentMsg && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200 mb-4">
          {sentMsg}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Churn rate (90d)" value={`${data.churnRate90d}%`} accent={data.churnRate90d >= 10 ? 'red' : data.churnRate90d >= 5 ? 'amber' : 'green'} />
        <StatCard label="Exited (90d)" value={data.exitedCount90d} />
        <StatCard label="Total members" value={data.totalMembers} />
        <StatCard label="At-risk members" value={atRisk.length} accent={atRisk.length > 0 ? 'amber' : 'green'} />
      </div>

      <div className="card-premium p-5 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Monthly exits (last 6 months)</h3>
        <HDBarChart data={(data.trend || []).map(t=>({label:t.label,value:t.exited}))} height={160} color="#f87171" />
      </div>

      <div className="card-premium p-5 mb-6">
        <h3 className="text-sm font-bold text-gray-900 mb-2">Risk model</h3>
        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          {Object.entries(data.weights || {}).map(([code, w]) => (
            <span key={code} className="px-2 py-1 rounded-lg bg-gray-100 border border-gray-200">
              +{w} · {code.replace(/_/g, ' ')}
            </span>
          ))}
          <span className="px-2 py-1 rounded-lg bg-gray-100 border border-gray-200">
            at-risk from {data.threshold}+
          </span>
        </div>
      </div>

      <div className="card-premium p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">At-risk members ({atRisk.length})</h3>
        {atRisk.length === 0 ? (
          <p className="text-sm text-gray-500">No members currently flagged at risk. 🎉</p>
        ) : (
          <DataTable columns={columns} rows={atRisk} />
        )}
      </div>

      {offerFor && (
        <OfferModal
          member={offerFor}
          onClose={() => setOfferFor(null)}
          onSent={() => {
            setOfferFor(null);
            setSentMsg(`Retention offer sent to ${offerFor.memberName}.`);
            setTimeout(() => setSentMsg(''), 5000);
          }}
        />
      )}
    </div>
  );
}
