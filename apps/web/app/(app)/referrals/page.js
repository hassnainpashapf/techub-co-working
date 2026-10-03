'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useRequireRoles } from '../../../components/Protected';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../components/ui';

function statusBadge(s) {
  const tone = s === 'rewarded' ? 'green' : s === 'joined' ? 'blue' : 'amber';
  return <Badge tone={tone}>{s}</Badge>;
}

export default function StaffReferralsPage() {
  useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'finance_officer');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [rewardAmount, setRewardAmount] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const d = await api.get(`/referrals${filter ? `?status=${filter}` : ''}`);
      setData(d);
    } catch (e) {
      setError(e.message || 'Failed to load referrals.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filter]);

  async function markJoined(id) {
    setBusyId(id);
    try {
      await api.post(`/referrals/${id}/mark-joined`);
      load();
    } catch (e) {
      alert(e.message || 'Failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function markRewarded(id) {
    if (!confirm('Create a credit note reward for the referrer?')) return;
    setBusyId(id);
    try {
      const res = await api.post(`/referrals/${id}/mark-rewarded`, {});
      alert(`Rewarded! Credit note ${res.creditNote.number} created.`);
      load();
    } catch (e) {
      alert(e.message || 'Failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function openSettings() {
    try {
      const s = await api.get('/referrals/settings');
      setRewardAmount(String(s.referralRewardAmount ?? 0));
      setShowSettings(true);
    } catch (e) {
      alert(e.message || 'Failed to load settings.');
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const s = await api.put('/referrals/settings', { referralRewardAmount: Number(rewardAmount) });
      setData((d) => (d ? { ...d, rewardAmount: s.referralRewardAmount } : d));
      setShowSettings(false);
    } catch (err) {
      alert(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <div className="p-8"><Spinner /></div>;
  const counts = data?.counts || {};

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Referrals"
        sub="Track member invitations and reward referrers."
        actions={<button className="btn-secondary" onClick={openSettings}>⚙ Reward settings</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Invited" value={counts.invited || 0} accent="amber" icon="✉️" />
        <StatCard label="Joined" value={counts.joined || 0} accent="blue" icon="🤝" />
        <StatCard label="Rewarded" value={counts.rewarded || 0} accent="green" icon="🎁" />
        <StatCard
          label="Reward amount"
          value={data?.rewardAmount > 0 ? `Rs ${Number(data.rewardAmount).toLocaleString()}` : 'Not set'}
          sub="per successful referral"
          accent="purple"
          icon="💰"
        />
      </div>

      <div className="flex gap-2 mb-4">
        {['', 'invited', 'joined', 'rewarded'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === s ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : !data?.referrals?.length ? (
        <EmptyState title="No referrals" hint="No referrals match this filter." />
      ) : (
        <div className="card-premium overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-white/10">
                <th className="p-3">Referred</th>
                <th className="p-3">Referrer</th>
                <th className="p-3">Code</th>
                <th className="p-3">Status</th>
                <th className="p-3">Reward</th>
                <th className="p-3">Date</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.referrals.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3">
                    <div className="text-white font-medium">{r.referredName}</div>
                    <div className="text-xs text-slate-400">{r.referredEmail}</div>
                  </td>
                  <td className="p-3 text-slate-300">{r.code?.member?.name || '—'}</td>
                  <td className="p-3 text-slate-400 font-mono text-xs">{r.code?.code}</td>
                  <td className="p-3">{statusBadge(r.status)}</td>
                  <td className="p-3 text-slate-300">{r.rewardAmount ? `Rs ${Number(r.rewardAmount).toLocaleString()}` : '—'}</td>
                  <td className="p-3 text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      {r.status === 'invited' && (
                        <button className="btn-secondary text-xs" disabled={busyId === r.id} onClick={() => markJoined(r.id)}>
                          Mark joined
                        </button>
                      )}
                      {r.status === 'joined' && (
                        <button className="btn-primary text-xs" disabled={busyId === r.id} onClick={() => markRewarded(r.id)}>
                          Reward
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showSettings && (
        <Modal title="Referral reward settings" onClose={() => setShowSettings(false)}>
          <form onSubmit={saveSettings}>
            <Field label="Reward amount (Rs) — credit note per successful referral">
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={rewardAmount}
                onChange={(e) => setRewardAmount(e.target.value)}
                required
              />
            </Field>
            <button className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
