'use client';

import { useEffect, useState } from 'react';
import { api, getTokens, setTokens } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, DataTable } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const IMP_KEY = 'cw_impersonating';
const BACKUP_KEY = 'cw_impersonate_backup';

function loadImpersonation() {
  try {
    const raw = window.sessionStorage.getItem(IMP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function AdminTenantsPage() {
  const { allowed } = useRequireRoles(['super_admin']);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(null);
  const [impersonating, setImpersonating] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/admin/tenants')
      .then((d) => setTenants(d.tenants || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); setImpersonating(loadImpersonation()); }, []);

  const toggleSuspend = async (t) => {
    const suspending = !t.suspended;
    const reason = suspending ? prompt(`Suspend "${t.name}"? Optional reason:`, '') : null;
    if (suspending && reason === null) return; // cancelled prompt
    setActionBusy(t.id);
    try {
      await api.patch(`/admin/tenants/${t.id}`, { suspended: suspending, reason: reason || null });
      load();
    } catch (e) { setError(e.message); } finally { setActionBusy(null); }
  };

  const impersonate = async (t) => {
    if (!confirm(`Impersonate ${t.name} as its admin for 15 minutes? This is audited.`)) return;
    setActionBusy(t.id);
    try {
      const d = await api.post(`/admin/tenants/${t.id}/impersonate`);
      // Backup current super_admin tokens, switch to the impersonation token
      window.sessionStorage.setItem(BACKUP_KEY, JSON.stringify(getTokens()));
      setTokens({ access: d.token, refresh: getTokens().refresh });
      const info = { tenantName: d.tenant.name, userEmail: d.user.email, startedAt: Date.now() };
      window.sessionStorage.setItem(IMP_KEY, JSON.stringify(info));
      setImpersonating(info);
      window.location = '/dashboard';
    } catch (e) { setError(e.message); } finally { setActionBusy(null); }
  };

  const exitImpersonation = () => {
    try {
      const raw = window.sessionStorage.getItem(BACKUP_KEY);
      if (raw) {
        const b = JSON.parse(raw);
        setTokens({ access: b.access, refresh: b.refresh });
      }
    } catch { /* ignore */ }
    window.sessionStorage.removeItem(IMP_KEY);
    window.sessionStorage.removeItem(BACKUP_KEY);
    window.location = '/admin/tenants';
  };

  const remove = async (t) => {
    if (!confirm(`Delete tenant "${t.name}"? Only allowed when it has no data.`)) return;
    setActionBusy(t.id);
    try { await api.del(`/admin/tenants/${t.id}`); load(); }
    catch (e) { setError(e.message); } finally { setActionBusy(null); }
  };

  if (!allowed) return <AccessDenied />;

  const cols = [
    { key: 'name', label: 'Tenant', render: (r) => (
      <div><div className="font-medium text-white">{r.name}</div>
      <div className="text-xs text-slate-500 font-mono">{r.slug}</div></div>
    )},
    { key: 'plan', label: 'Plan', render: (r) => <Badge>{r.plan || 'starter'}</Badge> },
    { key: 'users', label: 'Users', render: (r) => <span className="text-slate-300">{r.counts.users ?? '—'}</span> },
    { key: 'members', label: 'Members', render: (r) => <span className="text-slate-300">{r.counts.members ?? '—'}</span> },
    { key: 'docs', label: 'Documents', render: (r) => <span className="text-slate-300">{r.counts.documents ?? '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => r.suspended
      ? <Badge tone="red">Suspended</Badge>
      : <Badge tone="green">Active</Badge> },
    { key: 'createdAt', label: 'Created', render: (r) => (
      <span className="text-xs text-slate-400">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</span>
    )},
    { key: 'actions', label: 'Actions', render: (r) => (
      <div className="flex gap-2 justify-end">
        <button className="btn-sm" disabled={actionBusy === r.id}
          onClick={() => toggleSuspend(r)}>
          {r.suspended ? 'Activate' : 'Suspend'}
        </button>
        <button className="btn-sm" disabled={actionBusy === r.id || r.suspended}
          title={r.suspended ? 'Activate first to impersonate' : 'Log in as this tenant admin (15 min)'}
          onClick={() => impersonate(r)}>
          Impersonate
        </button>
        <button className="btn-sm btn-danger" disabled={actionBusy === r.id}
          onClick={() => remove(r)}>
          Delete
        </button>
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title="Tenant Management" subtitle="All workspaces — suspend, impersonate or delete (super admin)" />

      {impersonating && (
        <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-amber-200">
            🕵️ <strong>Impersonating {impersonating.tenantName}</strong>
            <span className="text-amber-200/70"> as {impersonating.userEmail} — token expires ~15 min after issue. Actions are audited.</span>
          </div>
          <button className="btn-sm" onClick={exitImpersonation}>Exit impersonation</button>
        </div>
      )}

      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      {loading ? <Spinner /> : (
        <DataTable
          columns={cols}
          rows={tenants}
          emptyText="No tenants found."
        />
      )}
      <p className="mt-3 text-xs text-slate-500">
        Suspended tenants cannot log in and their API access is blocked. Delete is only allowed for tenants with no users, members, bookings, invoices, payments or contracts.
      </p>
    </div>
  );
}
