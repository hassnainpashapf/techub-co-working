'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const REASON_LABELS = {
  invoice_payment: 'Invoice payment',
  referral_bonus: 'Referral bonus',
  manual_adjust: 'Staff adjustment',
  redeemed: 'Redeemed',
  welcome: 'Welcome bonus',
};

function fmtDate(s) {
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PortalLoyaltyPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [points, setPoints] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [balance, history] = await Promise.all([
        api.get('/loyalty/balance'),
        api.get('/loyalty/history'),
      ]);
      setData({ ...balance, entries: history.entries || [] });
    } catch (e) {
      setError(e.message || 'Failed to load loyalty points');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function redeem(e) {
    e.preventDefault();
    setRedeemMsg(null);
    const pts = Math.floor(Number(points));
    if (!pts || pts <= 0) return;
    if (pts > (data?.balance || 0)) {
      setRedeemMsg({ ok: false, text: 'Insufficient points.' });
      return;
    }
    setRedeeming(true);
    try {
      const r = await api.post('/loyalty/redeem', { points: pts });
      setRedeemMsg({
        ok: true,
        text: `${r.pointsRedeemed} points redeemed — credit note ${r.creditNote.number} (Rs ${Number(r.amount).toLocaleString()}) issued.`,
      });
      setPoints('');
      await load();
    } catch (err) {
      setRedeemMsg({ ok: false, text: err.message || 'Redemption failed' });
    } finally {
      setRedeeming(false);
    }
  }

  const balance = data?.balance || 0;
  const pointValue = data?.pointValue ?? 1;
  const rupeeValue = balance * pointValue;

  return (
    <div>
      <PageHeader title="Loyalty Points" subtitle="Earn points on every payment, redeem for discounts" />
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <StatCard label="My Points" value={balance.toLocaleString()} accent="violet" />
            <StatCard label="Worth" value={`Rs ${rupeeValue.toLocaleString()}`} accent="emerald" />
            <StatCard label="Earn Rate" value={`${data?.loyaltyRate ?? 10} pts / Rs 1,000`} accent="blue" />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-3">
            <h2 className="text-gray-900 font-semibold mb-3">Redeem Points</h2>
            <p className="text-xs text-gray-500 mb-3">
              1 point = Rs {pointValue}. Redeemed points become a credit note you can apply to invoices.
              Referral bonus: {data?.referralBonusPoints ?? 100} pts per successful referral.
            </p>
            <form onSubmit={redeem} className="flex flex-wrap items-end gap-3">
              <Field label="Points to redeem">
                <input
                  type="number"
                  min="1"
                  max={balance}
                  className="input w-40"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  placeholder="e.g. 100"
                />
              </Field>
              <div className="text-sm text-gray-500 pb-3">
                = <span className="text-emerald-700 font-semibold">Rs {(Math.floor(Number(points) || 0) * pointValue).toLocaleString()}</span>
              </div>
              <button type="submit" className="btn-primary" disabled={redeeming || balance <= 0}>
                {redeeming ? 'Redeeming…' : 'Redeem'}
              </button>
            </form>
            {redeemMsg && (
              <div className={`mt-3 text-sm rounded-lg px-4 py-3 border ${redeemMsg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {redeemMsg.text}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <h2 className="text-gray-900 font-semibold mb-3">History</h2>
            {(data?.entries || []).length === 0 ? (
              <EmptyState title="No activity yet" hint="Points are earned automatically when your invoices are paid in full." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 uppercase">
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Activity</th>
                      <th className="pb-2 text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.id} className="border-t border-gray-200">
                        <td className="py-2.5 pr-4 text-gray-500">{fmtDate(e.createdAt)}</td>
                        <td className="py-2.5 pr-4">
                          <Badge>{REASON_LABELS[e.reason] || e.reason}</Badge>
                        </td>
                        <td className={`py-2.5 text-right font-semibold ${e.points > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {e.points > 0 ? `+${e.points}` : e.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
