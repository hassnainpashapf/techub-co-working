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
  StatCard,
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

const ROLE_TONES = {
  ceo: 'dark',
  admin: 'indigo',
  operations_manager: 'violet',
  manager: 'blue',
  receptionist: 'teal',
  finance_officer: 'amber',
  office_boy: 'slate',
  member: 'green',
};

const AVATAR_COLORS = {
  ceo: 'bg-gray-800 text-white',
  admin: 'bg-indigo-600 text-white',
  operations_manager: 'bg-violet-600 text-white',
  manager: 'bg-blue-600 text-white',
  receptionist: 'bg-teal-600 text-white',
  finance_officer: 'bg-amber-500 text-white',
  office_boy: 'bg-slate-500 text-white',
  member: 'bg-emerald-600 text-white',
};

function prettyRole(role) {
  return (role || '').replace(/_/g, ' ');
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function roleOptionsFor(actorRole) {
  if (actorRole === 'ceo') return ALL_ROLES;
  if (actorRole === 'admin') return ALL_ROLES.filter((r) => r !== 'ceo');
  return ALL_ROLES.filter((r) => !['ceo', 'admin'].includes(r));
}

function UserForm({ initial, roleOptions, onSave, saving, isSelf }) {
  const [showPassword, setShowPassword] = useState(false);
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
        <Field label="Full name">
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="e.g. Ali Raza"
          />
        </Field>
        <Field label="Email address">
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            placeholder="name@company.com"
          />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+92 300 0000000"
          />
        </Field>
        <Field label="Role">
          <select
            className="input capitalize"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            disabled={isSelf}
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>{prettyRole(r)}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={initial ? 'New password (leave blank to keep current)' : 'Password'}>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            className="input pr-12"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required={!initial}
            minLength={6}
            placeholder="••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-teal-700 hover:text-teal-900"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>
      <Field label="Account status">
        <label className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            disabled={isSelf}
            className="h-4 w-4 rounded accent-teal-700"
          />
          Account is active
        </label>
        {isSelf && (
          <p className="text-xs text-gray-500 mt-1.5">You cannot change your own role or status.</p>
        )}
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? 'Saving…' : initial ? 'Save changes' : 'Add team member'}
      </button>
    </form>
  );
}

export default function UsersPage() {
  const { allowed } = useRequireRoles('ceo', 'admin');
  const { user: me } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
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

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.active !== false).length;
    const staff = users.filter((u) => !['member', 'ceo'].includes(u.role)).length;
    const admins = users.filter((u) => ['ceo', 'admin'].includes(u.role)).length;
    return { total, active, inactive: total - active, staff, admins };
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return [u.name, u.email, u.phone].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [users, search, roleFilter]);

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
    <div className="pb-10">
      <PageHeader
        title="Team Members"
        sub={`${stats.total} members · ${stats.active} active`}
        actions={
          <button className="btn-primary" onClick={() => setModal({ mode: 'add' })}>
            + Add member
          </button>
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total members" value={String(stats.total)} accent="teal" />
        <StatCard label="Active" value={String(stats.active)} sub={`${stats.inactive} inactive`} accent="green" />
        <StatCard label="Staff" value={String(stats.staff)} sub="non-admin team" accent="blue" />
        <StatCard label="Admins" value={String(stats.admins)} sub="CEO + admin" accent="indigo" />
      </div>

      {/* Search + filter toolbar */}
      <div className="card p-3 mb-4 flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="input pl-9"
            placeholder="Search by name, email or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input sm:w-52 capitalize"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="all">All roles</option>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>{prettyRole(r)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <DataTable
          columns={[
            {
              key: 'name',
              label: 'Member',
              render: (r) => (
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${AVATAR_COLORS[r.role] || AVATAR_COLORS.member}`}
                  >
                    {initials(r.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {r.name || '—'}
                      {me && r.id === me.id && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">You</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{r.email || '—'}</p>
                  </div>
                </div>
              ),
            },
            { key: 'phone', label: 'Phone', render: (r) => <span className="text-gray-600">{r.phone || '—'}</span> },
            {
              key: 'role',
              label: 'Role',
              render: (r) => (
                <Badge tone={ROLE_TONES[r.role] || 'slate'} className="capitalize">
                  {prettyRole(r.role)}
                </Badge>
              ),
            },
            {
              key: 'active',
              label: 'Status',
              render: (r) => (
                <Badge tone={r.active !== false ? 'green' : 'slate'} dot={r.active !== false}>
                  {r.active !== false ? 'Active' : 'Inactive'}
                </Badge>
              ),
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
          rows={filtered}
          empty={{
            title: search || roleFilter !== 'all' ? 'No matches found' : 'No team members',
            hint: search || roleFilter !== 'all' ? 'Try a different search or filter.' : 'Add your first team member.',
          }}
        />
      </div>

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add team member' : 'Edit team member'} onClose={() => setModal(null)}>
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
