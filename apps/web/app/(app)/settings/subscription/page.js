'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useAuth } from '../../../../context/AuthContext';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const CAN_CHANGE = ['ceo', 'admin', 'super_admin'];

function UsageBar({ label, used, limit }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="mb-4">
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-gray-600 font-medium">{label}</span>
        <span className="text-gray-500">{used} / {limit}</span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  const { user } = useAuth();
  const [sub, setSub] = useState(null);
  const [usage, setUsage] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/subscriptions/current'), api.get('/subscriptions/usage'), api.get('/subscriptions/plans')])
      .then(([s, u, p]) => { setSub(s.subscription); setUsage(u.usage); setPlans(p.plans || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const changePlan = async (slug) => {
    setChanging(slug);
    setError('');
    setNotice('');
    try {
      const d = await api.put('/subscriptions/change', { planSlug: slug });
      setSub(d.subscription);
      setNotice(`Plan changed to ${d.subscription.plan.name}.`);
    } catch (e) { setError(e.message); }
    finally { setChanging(''); }
  };

  const canChange = CAN_CHANGE.includes(user?.role);
  const statusTone = { active: 'green', trialing: 'blue', past_due: 'amber', cancelled: 'red' }[sub?.status] || 'slate';

  return (
    <div>
      <PageHeader title="Subscription" sub="Your organization's plan and usage" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {notice && <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">{notice}</div>}
      {loading ? <Spinner /> : (
        <>
          <div className="card-premium p-6 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Current Plan</div>
                <div className="text-2xl font-bold text-gray-900">{sub?.plan?.name || '—'}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone}>{sub?.status}</Badge>
                <span className="text-lg font-semibold text-gray-900">{money(sub?.plan?.priceMonthly)}<span className="text-xs text-gray-500 font-normal">/mo</span></span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-gray-500 mb-0.5">Billing period</div><div className="text-gray-800">{sub ? `${new Date(sub.currentPeriodStart).toLocaleDateString()} → ${new Date(sub.currentPeriodEnd).toLocaleDateString()}` : '—'}</div></div>
              {sub?.trialEndsAt && <div><div className="text-xs text-gray-500 mb-0.5">Trial ends</div><div className="text-gray-800">{new Date(sub.trialEndsAt).toLocaleDateString()}</div></div>}
            </div>
          </div>

          <div className="card-premium p-6 mb-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Usage vs Limits</h2>
            {usage ? (
              <>
                <UsageBar label="Users" used={usage.users.used} limit={usage.users.limit} />
                <UsageBar label="Members" used={usage.members.used} limit={usage.members.limit} />
                <UsageBar label="Units" used={usage.units.used} limit={usage.units.limit} />
              </>
            ) : <p className="text-sm text-gray-500">No usage data.</p>}
          </div>

          {canChange && (
            <div className="card-premium p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Change Plan</h2>
              <div className="grid md:grid-cols-3 gap-4">
                {plans.map((p) => {
                  const isCurrent = sub?.plan?.slug === p.slug;
                  return (
                    <div key={p.id} className={`rounded-xl border p-5 ${isCurrent ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="font-bold text-gray-900 text-lg">{p.name}</div>
                      <div className="text-gray-600 mt-1">{money(p.priceMonthly)}<span className="text-xs text-slate-500">/month</span></div>
                      <ul className="text-xs text-gray-500 mt-3 space-y-1">
                        <li>{p.maxUsers} users · {p.maxMembers} members · {p.maxUnits} units</li>
                        {(p.features || []).slice(0, 4).map((f) => <li key={f}>✓ {f}</li>)}
                      </ul>
                      <button
                        className={`mt-4 w-full ${isCurrent ? 'btn-secondary' : 'btn-primary'}`}
                        disabled={isCurrent || changing !== ''}
                        onClick={() => changePlan(p.slug)}
                      >
                        {isCurrent ? 'Current Plan' : changing === p.slug ? 'Changing…' : 'Switch'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
