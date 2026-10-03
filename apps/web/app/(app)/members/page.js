'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
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

const STATUS_TONE = { active: 'green', inactive: 'slate', suspended: 'red', pending: 'amber' };

function MemberForm({ initial, onSave, saving }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    cnic: initial?.cnic || '',
    companyName: initial?.companyName || '',
    emergencyContact: initial?.emergencyContact || '',
    status: initial?.status || 'active',
    notes: initial?.notes || '',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="03xx-xxxxxxx" /></Field>
        <Field label="Email"><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="CNIC"><input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="xxxxx-xxxxxxx-x" /></Field>
        <Field label="Company"><input className="input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></Field>
        <Field label="Emergency contact"><input className="input" value={form.emergencyContact} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} /></Field>
        <Field label="Status">
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Pending</option>
          </select>
        </Field>
        <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save member'}</button>
    </form>
  );
}

function MemberDetail({ member, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/members/${member.id}`)
      .then((d) => {
        if (!cancelled) setDetail(d.member || d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [member.id]);

  const m = detail || member;
  const contracts = m.contracts || [];
  const invoices = m.invoices || [];

  return (
    <Modal title={m.name} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : (
        <div>
          {error && <ErrorBanner message={error} />}
          <div className="grid grid-cols-2 gap-3 text-sm mb-5">
            <div><p className="text-xs text-slate-400">Phone</p><p className="font-medium">{m.phone || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Email</p><p className="font-medium">{m.email || '—'}</p></div>
            <div><p className="text-xs text-slate-400">CNIC</p><p className="font-medium">{m.cnic || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Company</p><p className="font-medium">{m.companyName || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Emergency contact</p><p className="font-medium">{m.emergencyContact || '—'}</p></div>
            <div><p className="text-xs text-slate-400">Status</p><Badge tone={STATUS_TONE[m.status] || 'slate'}>{m.status || '—'}</Badge></div>
          </div>
          {m.notes && <p className="text-sm text-slate-400 bg-white/5 rounded-lg p-3 mb-5">{m.notes}</p>}

          <h3 className="font-semibold text-white mb-2">Contracts ({contracts.length})</h3>
          <DataTable
            columns={[
              { key: 'unit', label: 'Unit', render: (r) => r.unitCode || r.unit?.code || '—' },
              { key: 'start', label: 'Start', render: (r) => (r.startDate ? String(r.startDate).slice(0, 10) : '—') },
              { key: 'end', label: 'End', render: (r) => (r.endDate ? String(r.endDate).slice(0, 10) : '—') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
            ]}
            rows={contracts}
            empty={{ title: 'No contracts' }}
          />

          <h3 className="font-semibold text-white mb-2 mt-5">Invoices ({invoices.length})</h3>
          <DataTable
            columns={[
              { key: 'no', label: 'Invoice', render: (r) => r.number || r.id?.slice(0, 8) || '—' },
              { key: 'amount', label: 'Amount', render: (r) => `Rs ${Number(r.amount || 0).toLocaleString()}` },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
            ]}
            rows={invoices.slice(0, 5)}
            empty={{ title: 'No invoices' }}
          />
        </div>
      )}
    </Modal>
  );
}

export default function MembersPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'receptionist');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', data} | {mode:'detail', data}
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const d = await api.get('/members');
      setMembers(d.members || d || []);
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return members.filter((m) => {
      const matchesQ =
        !q ||
        (m.name || '').toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q) ||
        (m.companyName || '').toLowerCase().includes(q);
      const matchesS = statusFilter === 'all' || m.status === statusFilter;
      return matchesQ && matchesS;
    });
  }, [members, search, statusFilter]);

  async function handleSave(payload) {
    setSaving(true);
    try {
      if (modal.mode === 'add') await api.post('/members', payload);
      else await api.put(`/members/${modal.data.id}`, payload);
      setModal(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this member? This cannot be undone.')) return;
    try {
      await api.del(`/members/${id}`);
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
        title="Members"
        sub={`${members.length} members`}
        actions={
          <button className="btn-primary" onClick={() => setModal({ mode: 'add' })}>
            + Add member
          </button>
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />

      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            className="input max-w-xs"
            placeholder="Search name, phone, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-white">{r.name}</span> },
            { key: 'phone', label: 'Phone' },
            { key: 'company', label: 'Company', render: (r) => r.companyName || '—' },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) => (
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: 'detail', data: r })}>View</button>
                  <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: 'edit', data: r })}>Edit</button>
                  <button className="btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Delete</button>
                </div>
              ),
            },
          ]}
          rows={filtered}
          empty={{ title: 'No members found', hint: 'Try a different search or add a new member.' }}
        />
      </div>

      {(modal?.mode === 'add' || modal?.mode === 'edit') && (
        <Modal title={modal.mode === 'add' ? 'Add member' : 'Edit member'} onClose={() => setModal(null)}>
          <MemberForm initial={modal.data} onSave={handleSave} saving={saving} />
        </Modal>
      )}
      {modal?.mode === 'detail' && (
        <MemberDetail member={modal.data} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
