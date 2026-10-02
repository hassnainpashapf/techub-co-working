'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const ALL_ROLES = [
  'ceo',
  'admin',
  'operations_manager',
  'manager',
  'receptionist',
  'finance_officer',
  'office_boy',
  'member',
];

function roleOptionsFor(actorRole) {
  if (actorRole === 'ceo') return ALL_ROLES;
  if (actorRole === 'admin') return ALL_ROLES.filter((r) => r !== 'ceo');
  return ALL_ROLES.filter((r) => !['ceo', 'admin'].includes(r));
}

function UserForm({ initial, roleOptions, onSave, saving, isSelf }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    role: initial?.role || 'receptionist',
    password: '',
    active: initial?.active !== false,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        onSave(payload);
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Email"><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Role">
          <select className="input capitalize" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} disabled={isSelf}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={initial ? 'New password (leave blank to keep)' : 'Password'}>
        <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!initial} minLength={6} placeholder="••••••" />
      </Field>
      <Field label="Active">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} disabled={isSelf} className="h-4 w-4" />
          Account is active
        </label>
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save user'}</button>
    </form>
  );
}

export default function UsersPage() {
  const { allowed } = useRequireRoles('ceo', 'admin');
  const { user: me } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', data}
  const [saving, setSaving] = useState(false);

  const roleOptions = useMemo(() => roleOptionsFor(me?.role), [me]);

  const refresh = async () => {
    setError('');
    try {
      const d = await api.get('/users');
      setUsers(d.users || d || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(payload) {
    setSaving(true);
    try {
      if (modal.mode === 'add') await api.post('/users', payload);
      else await api.put(`/users/${modal.data.id}`, payload);
      setModal(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    try {
      await api.patch(`/users/${row.id}`, { active: !row.active });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this user? This cannot be undone.')) return;
    try {
      await api.del(`/users/${id}`);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Users"
        sub={`${users.length} users`}
        actions={<button className="btn-primary" onClick={() => setModal({ mode: 'add' })}>+ Add user</button>}
      />
      <ErrorBanner message={error} onRetry={refresh} />

      <div className="card">
        <DataTable
          columns={[
            { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-slate-900">{r.name || '—'}</span> },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
            { key: 'role', label: 'Role', render: (r) => <Badge tone="indigo" className="capitalize">{(r.role || '').replace(/_/g, ' ')}</Badge> },
            {
              key: 'active',
              label: 'Status',
              render: (r) => <Badge tone={r.active !== false ? 'green' : 'slate'}>{r.active !== false ? 'Active' : 'Inactive'}</Badge>,
            },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) => {
                const isSelf = me && r.id === me.id;
                return (
                  <div className="flex gap-2">
                    <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: 'edit', data: r })}>Edit</button>
                    {!isSelf && (
                      <>
                        <button className="btn-secondary btn-sm" onClick={() => toggleActive(r)}>
                          {r.active !== false ? 'Deactivate' : 'Activate'}
                        </button>
                        <button className="btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Delete</button>
                      </>
                    )}
                  </div>
                );
              },
            },
          ]}
          rows={users}
          empty={{ title: 'No users', hint: 'Add your first user.' }}
        />
      </div>

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add user' : 'Edit user'} onClose={() => setModal(null)}>
          <UserForm
            initial={modal.data}
            roleOptions={roleOptions}
            onSave={handleSave}
            saving={saving}
            isSelf={me && modal.data?.id === me.id}
          />
        </Modal>
      )}
    </div>
  );
}
