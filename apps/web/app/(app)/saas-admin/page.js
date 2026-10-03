'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, DataTable, Field, Modal } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

export default function SaasAdminPage() {
  const { allowed } = useRequireRoles(['super_admin']);
  const [overview, setOverview] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/tenants/overview'), api.get('/tenants')])
      .then(([o, t]) => { setOverview(o.overview); setTenants(t.tenants || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const toggleActive = async (t) => {
    try {
      await api.patch(`/tenants/${t.id}`, { isActive: !t.isActive });
      load();
    } catch (e) { setError(e.message); }
  };

  const columns = [
    { key: 'name', label: 'Organization', render: (t) => <div><div className="font-medium text-white">{t.name}</div><div className="text-xs text-slate-400">{t.slug}</div></div> },
    { key: 'plan', label: 'Plan', render: (t) => <Badge tone={t.plan === 'enterprise' ? 'amber' : t.plan === 'growth' ? 'blue' : 'slate'}>{t.plan}</Badge> },
    { key: 'users', label: 'Users', render: (t) => <span className="text-slate-300">{t._count?.users || 0}</span> },
    { key: 'members', label: 'Members', render: (t) => <span className="text-slate-300">{t._count?.members || 0}</span> },
    { key: 'units', label: 'Units', render: (t) => <span className="text-slate-300">{t._count?.units || 0}</span> },
    { key: 'status', label: 'Status', render: (t) => <Badge tone={t.isActive ? 'green' : 'red'}>{t.isActive ? 'Active' : 'Suspended'}</Badge> },
    { key: 'action', label: '', render: (t) => <button className="btn-secondary text-xs px-2 py-1" onClick={() => toggleActive(t)}>{t.isActive ? 'Suspend' : 'Activate'}</button> },
  ];

  return (
    <div>
      <PageHeader title="SaaS Admin" subtitle="Platform overview — all organizations" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {[
              ['Organizations', overview?.tenants || 0],
              ['Total Users', overview?.users || 0],
              ['Total Members', overview?.members || 0],
              ['Total Bookings', overview?.bookings || 0],
              ['Platform Revenue', money(overview?.totalRevenue)],
            ].map(([l, v]) => (
              <div key={l} className="card-premium p-4">
                <div className="text-2xl font-extrabold text-white">{v}</div>
                <div className="text-xs text-slate-400">{l}</div>
              </div>
            ))}
          </div>
          {overview?.byPlan && Object.keys(overview.byPlan).length > 0 && (
            <div className="card-premium p-4 mb-6">
              <h3 className="font-bold text-white mb-2 text-sm">Tenants by Plan</h3>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(overview.byPlan).map(([plan, count]) => (
                  <span key={plan} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 capitalize">
                    {plan}: <span className="font-bold text-white">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <h2 className="font-bold text-white mb-3">All Organizations</h2>
          <DataTable columns={columns} rows={tenants} emptyText="No organizations." />
        </>
      )}
    </div>
  );
}
