'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

function statusBadge(s) {
  const tone = s === 'rewarded' ? 'green' : s === 'joined' ? 'blue' : 'amber';
  return <Badge tone={tone}>{s}</Badge>;
}

export default function MemberReferralsPage() {
  const [code, setCode] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [c, r] = await Promise.all([
        api.get('/referrals/my-code'),
        api.get('/referrals/my-referrals'),
      ]);
      setCode(c);
      setReferrals(r.referrals || []);
    } catch (e) {
      setError(e.message || 'Failed to load referrals.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function invite(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    try {
      await api.post('/referrals/invite', { name, email });
      setName('');
      setEmail('');
      setShowInvite(false);
      load();
    } catch (err) {
      setFormError(err.message || 'Failed to send invite.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-5"><Spinner /></div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Referrals"
        sub="Invite friends and earn credits when they join."
        actions={<button className="btn-primary" onClick={() => setShowInvite(true)}>+ Invite a friend</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      {code && (
        <div className="grid sm:grid-cols-3 gap-3 mb-3">
          <div className="card-premium p-5 sm:col-span-2">
            <p className="text-xs font-semibold text-gray-500 mb-1">YOUR REFERRAL CODE</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-extrabold tracking-widest text-gray-900">{code.code}</span>
              <button className="btn-secondary text-sm" onClick={copyCode}>
                {copied ? '✓ Copied!' : 'Copy invite link'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 break-all">{code.joinUrl}</p>
          </div>
          <StatCard
            label="Reward per referral"
            value={code.rewardAmount > 0 ? `Rs ${Number(code.rewardAmount).toLocaleString()}` : '—'}
            sub="as account credit"
            accent="green"
            icon="🎁"
          />
        </div>
      )}

      <h2 className="text-lg font-bold text-gray-900 mb-3">My invitations</h2>
      {referrals.length === 0 ? (
        <EmptyState title="No invitations yet" hint="Invite a friend to get started." />
      ) : (
        <div className="overflow-x-auto card-premium overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Status</th>
                <th className="p-3">Reward</th>
                <th className="p-3">Sent</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} className="border-b border-gray-200 hover:bg-gray-100">
                  <td className="p-3 text-gray-900 font-medium">{r.referredName}</td>
                  <td className="p-3 text-gray-600">{r.referredEmail}</td>
                  <td className="p-3">{statusBadge(r.status)}</td>
                  <td className="p-3 text-gray-600">{r.rewardAmount ? `Rs ${Number(r.rewardAmount).toLocaleString()}` : '—'}</td>
                  <td className="p-3 text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <Modal title="Invite a friend" onClose={() => setShowInvite(false)}>
          <form onSubmit={invite}>
            <Field label="Friend's name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ali Raza" />
            </Field>
            <Field label="Friend's email">
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="ali@example.com" />
            </Field>
            {formError && <p className="text-sm text-red-700 mb-3">{formError}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
