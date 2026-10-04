'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, DataTable, EmptyState } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

export default function SaaSPlansPage() {
  const { allowed } = useRequireRoles(['super_admin']);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    api.get('/subscriptions/plans')
      .then((d) => setPlans(d.plans || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const columns = [
    { key: 'name', label: 'Plan', render: (p) => (
      <div><div className="font-semibold text-gray-900">{p.name}</div><div className="text-xs text-gray-500 font-mono">{p.slug}</div></div>
    ) },
    { key: 'price', label: 'Price / month', render: (p) => <span className="text-gray-900 font-medium">{money(p.priceMonthly)}</span> },
    { key: 'users', label: 'Max Users', render: (p) => <span className="text-gray-600">{p.maxUsers}</span> },
    { key: 'members', label: 'Max Members', render: (p) => <span className="text-gray-600">{p.maxMembers}</span> },
    { key: 'units', label: 'Max Units', render: (p) => <span className="text-gray-600">{p.maxUnits}</span> },
    { key: 'features', label: 'Features', render: (p) => (
      <div className="flex flex-wrap gap-1 max-w-[280px]">
        {(p.features || []).map((f) => <Badge key={f} tone="slate">{f}</Badge>)}
      </div>
    ) },
    { key: 'status', label: 'Status', render: (p) => <Badge tone={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Active' : 'Inactive'}</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Platform Plans" sub="Subscription tiers offered to organizations" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : plans.length === 0 ? <EmptyState title="No plans" hint="Plans will be seeded automatically." /> : (
        <DataTable columns={columns} rows={plans} empty="No plans found." />
      )}
      <p className="text-xs text-slate-500 mt-4">Plans are seeded automatically (starter / growth / enterprise). Tenants are put on Starter by default; they can upgrade from Settings → Subscription.</p>
    </div>
  );
}
