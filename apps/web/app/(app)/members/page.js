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
import SavedViews from '../../../components/SavedViews';
import { useAuth } from '../../../context/AuthContext';

const STATUS_TONE = { active: 'green', inactive: 'slate', suspended: 'red', pending: 'amber' };
const BULK_ROLES = ['ceo', 'admin', 'manager', 'super_admin'];

function MemberForm({ initial, onSave, saving }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    cnic: initial?.cnic || '',
    companyName: initial?.companyName || '',
    companyId: initial?.companyId || '',
    emergencyContact: initial?.emergencyContact || '',
    status: initial?.status || 'active',
    notes: initial?.notes || '',
  });
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    api.get('/companies').then((d) => setCompanies(d.companies || [])).catch(() => {});
  }, []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const payload = { ...form };
        // If a company is selected from dropdown, backend syncs companyName — drop free text
        if (payload.companyId) delete payload.companyName;
        else delete payload.companyId;
        onSave(payload);
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="03xx-xxxxxxx" /></Field>
        <Field label="Email"><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="CNIC"><input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="xxxxx-xxxxxxx-x" /></Field>
        <Field label="Company (linked)">
          <select className="input" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            <option value="">— Select company —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Company (free text)">
          <input
            className="input"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            placeholder="Used when no company selected"
            disabled={!!form.companyId}
          />
        </Field>
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

function MemberTimeline({ memberId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api.get(`/members/${memberId}/timeline`)
      .then((d) => { if (!cancelled) setEvents(d.events || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [memberId]);
  if (loading) return <Spinner />;
  if (!events.length) return <p className="text-sm text-slate-400">No activity yet.</p>;
  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-1 bottom-1 w-px bg-white/10" />
      {events.map((e, i) => (
        <div key={i} className="relative pb-4">
          <div className="absolute -left-6 top-0 w-5 h-5 rounded-full bg-[#1a1a2c] border border-white/15 flex items-center justify-center text-[10px]">{e.icon}</div>
          <p className="text-sm text-white font-medium">{e.title}</p>
          {e.detail && <p className="text-xs text-slate-400">{e.detail}</p>}
          <p className="text-[11px] text-slate-500">{e.at ? new Date(e.at).toLocaleString() : ''}</p>
        </div>
      ))}
    </div>
  );
}

function MemberDetail({ member, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('overview');

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
          <div className="flex gap-2 mb-5">
            {['overview', 'timeline'].map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${tab === t ? 'border-violet-400/60 bg-violet-500/20 text-violet-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'timeline' ? (
            <MemberTimeline memberId={m.id} />
          ) : (
          <div>
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
        </div>
      )}
    </Modal>
  );
}

export default function MembersPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'receptionist');
  const { user } = useAuth();
  const canBulk = BULK_ROLES.includes(user?.role);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', data} | {mode:'detail', data}
  const [saving, setSaving] = useState(false);
  // Phase 30: bulk selection
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('active');
  const [bulkBusy, setBulkBusy] = useState(false);
  // Phase 29 Track 4: expiring contracts
  const [expiring, setExpiring] = useState([]);
  const [renewTarget, setRenewTarget] = useState(null);
  const [renewDate, setRenewDate] = useState('');
  const [renewRent, setRenewRent] = useState('');
  const [renewing, setRenewing] = useState(false);

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

  // Phase 29 Track 4: load contracts expiring in the next 30 days
  useEffect(() => {
    api.get('/contract-renewals/expiring?days=30')
      .then((d) => setExpiring(d.items || []))
      .catch(() => setExpiring([]));
  }, []);

  async function handleRenew() {
    if (!renewTarget || !renewDate) return;
    setRenewing(true);
    try {
      const payload = { endDate: renewDate };
      if (renewRent !== '') payload.rentAmount = Number(renewRent);
      await api.post(`/contract-renewals/${renewTarget.id}/renew`, payload);
      setRenewTarget(null);
      setRenewDate('');
      setRenewRent('');
      const d = await api.get('/contract-renewals/expiring?days=30').catch(() => null);
      setExpiring(d?.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setRenewing(false);
    }
  }

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

  // Phase 30: bulk actions
  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.length === filtered.length ? [] : filtered.map((m) => m.id)));
  };
  async function handleBulkStatus() {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const d = await api.post('/members/bulk/status', { ids: selectedIds, status: bulkStatus });
      setSelectedIds([]);
      await refresh();
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  }
  async function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Mark ${selectedIds.length} member(s) as exited?`)) return;
    setBulkBusy(true);
    try {
      await api.post('/members/bulk/delete', { ids: selectedIds });
      setSelectedIds([]);
      await refresh();
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const selectColumn = canBulk
    ? [
        {
          key: '__select',
          label: <input type="checkbox" checked={filtered.length > 0 && selectedIds.length === filtered.length} onChange={toggleSelectAll} title="Select all" />,
          render: (r) => <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} />,
        },
      ]
    : [];

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

      {/* Phase 29 Track 4: contracts expiring soon */}
      {expiring.length > 0 && (
        <div className="card mb-4 border-amber-400/30">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⏳</span>
            <h3 className="font-semibold text-white">Contracts expiring soon ({expiring.length})</h3>
            <Badge tone="amber">next 30 days</Badge>
          </div>
          <DataTable
            columns={[
              { key: 'member', label: 'Member', render: (r) => <span className="font-medium text-white">{r.member?.name || '—'}</span> },
              { key: 'unit', label: 'Unit', render: (r) => r.unit?.code || '—' },
              { key: 'end', label: 'Ends', render: (r) => (r.endDate ? String(r.endDate).slice(0, 10) : '—') },
              { key: 'left', label: 'Days left', render: (r) => <Badge tone={r.daysLeft <= 7 ? 'red' : r.daysLeft <= 14 ? 'amber' : 'slate'}>{r.daysLeft}</Badge> },
              {
                key: 'actions', label: '', render: (r) => (
                  <button className="btn-primary btn-sm" onClick={() => { setRenewTarget(r); setRenewDate(''); setRenewRent(''); }}>
                    Renew
                  </button>
                ),
              },
            ]}
            rows={expiring}
            empty={{ title: 'None' }}
          />
        </div>
      )}

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
          <SavedViews
            page="members"
            currentFilters={{ search, statusFilter }}
            onApply={(f) => {
              if (typeof f.search === 'string') setSearch(f.search);
              if (typeof f.statusFilter === 'string') setStatusFilter(f.statusFilter);
            }}
          />
        </div>
      </div>

      <div className="card">
        {/* Phase 30: bulk actions bar */}
        {canBulk && selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-400/30">
            <span className="text-sm font-semibold text-blue-200">{selectedIds.length} selected</span>
            <select className="input max-w-[160px] !w-auto" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="on_hold">On hold</option>
            </select>
            <button className="btn-primary btn-sm" onClick={handleBulkStatus} disabled={bulkBusy}>
              {bulkBusy ? 'Applying…' : 'Apply status'}
            </button>
            <button className="btn-danger btn-sm" onClick={handleBulkDelete} disabled={bulkBusy}>
              Mark exited
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        )}
        <DataTable
          columns={[
            ...selectColumn,
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

      {/* Phase 29 Track 4: renew contract modal */}
      {renewTarget && (
        <Modal title={`Renew contract — ${renewTarget.member?.name || ''} (${renewTarget.unit?.code || ''})`} onClose={() => setRenewTarget(null)}>
          <p className="text-sm text-slate-400 mb-4">
            Current ends <b className="text-white">{String(renewTarget.endDate).slice(0, 10)}</b>. A new contract will start the next day; the old one will be marked expired.
          </p>
          <Field label="New end date">
            <input type="date" className="input" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} required />
          </Field>
          <Field label="Rent amount (optional — keep current if empty)">
            <input type="number" min="0" step="0.01" className="input" value={renewRent} onChange={(e) => setRenewRent(e.target.value)} placeholder={String(renewTarget.rentAmount ?? '')} />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary" onClick={() => setRenewTarget(null)}>Cancel</button>
            <button className="btn-primary" disabled={!renewDate || renewing} onClick={handleRenew}>
              {renewing ? 'Renewing…' : 'Renew contract'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
