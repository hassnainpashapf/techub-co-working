'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable } from '../../../components/ui';

function CompanyForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    industry: initial?.industry || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    address: initial?.address || '',
    website: initial?.website || '',
    notes: initial?.notes || '',
    isActive: initial?.isActive ?? true,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Company Name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="e.g. Acme Pvt Ltd" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Industry"><input className="input" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} placeholder="e.g. Software" /></Field>
        <Field label="Website"><input className="input" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://example.com" /></Field>
        <Field label="Email"><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="info@company.com" /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0300-1234567" /></Field>
      </div>
      <Field label="Address"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Office address" /></Field>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Any notes…" /></Field>
      <label className="flex items-center gap-2 text-sm text-gray-600 mb-3">
        <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="accent-teal-600" />
        Active
      </label>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.name.trim()}>{saving ? 'Saving…' : (initial ? 'Update Company' : 'Create Company')}</button>
    </form>
  );
}

function CompanyDetail({ company, onClose, onEdit, onDelete }) {
  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-xl font-bold text-gray-900">{company.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            {company.industry && <span className="text-xs text-gray-500">{company.industry}</span>}
            <Badge tone={company.isActive ? 'green' : 'slate'}>{company.isActive ? 'Active' : 'Inactive'}</Badge>
            <Badge tone="blue">{company._count?.members || 0} members</Badge>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        {company.email && <div><div className="text-xs text-slate-500">Email</div><div className="text-gray-800">{company.email}</div></div>}
        {company.phone && <div><div className="text-xs text-slate-500">Phone</div><div className="text-gray-800">{company.phone}</div></div>}
        {company.website && <div><div className="text-xs text-slate-500">Website</div><a href={company.website} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">{company.website}</a></div>}
        {company.address && <div className="col-span-2"><div className="text-xs text-slate-500">Address</div><div className="text-gray-800">{company.address}</div></div>}
      </div>
      {company.notes && <p className="text-sm text-gray-500 mb-3">{company.notes}</p>}
      <h4 className="text-sm font-semibold text-gray-800 mb-2">Linked Members</h4>
      {company.members?.length ? (
        <ul className="space-y-1.5 max-h-48 overflow-y-auto">
          {company.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between bg-gray-100 rounded-lg px-3 py-2">
              <span className="text-sm text-gray-800">{m.name}</span>
              <Badge tone={m.status === 'active' ? 'green' : 'slate'}>{m.status}</Badge>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-500 mb-2">No members linked yet.</p>}
      <div className="flex gap-2 mt-3">
        <button className="btn-secondary flex-1" onClick={onEdit}>Edit</button>
        <button className="btn-danger flex-1" onClick={onDelete}>Delete</button>
        <button className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async (q) => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get('/companies' + (q ? `?search=${encodeURIComponent(q)}` : ''));
      setCompanies(d.companies || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(''); }, []);

  const onSearch = (e) => {
    e.preventDefault();
    load(search);
  };

  const onSave = async (data) => {
    setSaving(true);
    try {
      if (editing) await api.patch(`/companies/${editing.id}`, data);
      else await api.post('/companies', data);
      setShowForm(false);
      setEditing(null);
      load(search);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (id) => {
    try {
      const d = await api.get(`/companies/${id}`);
      setDetail(d.company);
    } catch (e) {
      setError(e.message);
    }
  };

  const onDelete = async (id, name) => {
    if (!confirm(`Delete "${name}"? Linked members will be unlinked.`)) return;
    try {
      await api.delete(`/companies/${id}`);
      setDetail(null);
      load(search);
    } catch (e) {
      setError(e.message);
    }
  };

  const cols = [
    { key: 'name', label: 'Company', render: (r) => <button className="font-semibold text-gray-900 hover:text-teal-700" onClick={() => openDetail(r.id)}>{r.name}</button> },
    { key: 'industry', label: 'Industry', render: (r) => <span className="text-sm text-gray-500">{r.industry || '—'}</span> },
    { key: 'contact', label: 'Contact', render: (r) => <span className="text-sm text-gray-500">{r.phone || r.email || '—'}</span> },
    { key: 'members', label: 'Members', render: (r) => <Badge tone="blue">{r._count?.members || 0}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', label: '', render: (r) => (
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost text-xs" onClick={() => openDetail(r.id)}>View</button>
          <button className="btn-ghost text-xs" onClick={() => { setEditing(r); setShowForm(true); }}>Edit</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle="Organizations your members belong to"
        actions={
          <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New Company</button>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <form onSubmit={onSearch} className="flex gap-2 mb-3">
        <input className="input flex-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies by name or industry…" />
        <button type="submit" className="btn-secondary">Search</button>
      </form>
      {loading ? <Spinner /> : <DataTable columns={cols} rows={companies} emptyText="No companies yet. Create one to get started." />}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Company' : 'New Company'}>
        <CompanyForm initial={editing} onSave={onSave} saving={saving} />
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Company Details">
        {detail && (
          <CompanyDetail
            company={detail}
            onClose={() => setDetail(null)}
            onEdit={() => { setDetail(null); setEditing(detail); setShowForm(true); }}
            onDelete={() => onDelete(detail.id, detail.name)}
          />
        )}
      </Modal>
    </div>
  );
}
