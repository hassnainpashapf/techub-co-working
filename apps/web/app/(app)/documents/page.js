'use client';

import { useEffect, useState } from 'react';
import { api, apiUpload, apiDownload } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const CN_TONES = { open: 'blue', applied: 'green', cancelled: 'slate' };
const DOC_CATS = ['contract', 'id', 'invoice', 'policy', 'other'];

function DocForm({ members, onSave, saving }) {
  const [f, setF] = useState({ title: '', category: 'general', memberId: '', notes: '' });
  const [file, setFile] = useState(null);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, memberId: f.memberId || null, file }); }}>
      <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Membership Agreement (optional if file chosen)" /></Field>
      <Field label="File *">
        <input type="file" className="input file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-teal-600/20 file:text-violet-700 file:text-xs"
          onChange={(e) => setFile(e.target.files?.[0] || null)} required
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv" />
        <p className="text-[11px] text-slate-500 mt-1">PDF, images, Word/Excel, TXT, CSV — max 25MB</p>
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Category">
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {DOC_CATS.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
          </select>
        </Field>
        <Field label="Member (optional)">
          <select className="input" value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })}>
            <option value="">—</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Uploading…' : 'Upload Document'}</button>
    </form>
  );
}

function CnForm({ members, onSave, saving }) {
  const [f, setF] = useState({ memberId: '', amount: '', reason: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ memberId: f.memberId, amount: Number(f.amount), reason: f.reason || null }); }}>
      <Field label="Member">
        <select className="input" value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })} required>
          <option value="">Select member…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="Amount (Rs)"><input type="number" min="1" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
      <Field label="Reason"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Overcharged for October" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Creating…' : 'Issue Credit Note'}</button>
    </form>
  );
}

export default function DocumentsPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'finance_officer', 'receptionist']);
  const [tab, setTab] = useState('docs');
  const [docs, setDocs] = useState([]);
  const [cns, setCns] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDocForm, setShowDocForm] = useState(false);
  const [showCnForm, setShowCnForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/documents/documents'), api.get('/documents/credit-notes'), api.get('/members')])
      .then(([d, c, m]) => { setDocs(d.documents || []); setCns(c.creditNotes || []); setMembers(m.members || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const addDoc = async (data) => {
    setSaving(true);
    try {
      const fd = new FormData();
      if (data.file) fd.append('file', data.file);
      if (data.title) fd.append('title', data.title);
      fd.append('category', data.category || 'general');
      if (data.memberId) fd.append('memberId', data.memberId);
      if (data.notes) fd.append('notes', data.notes);
      await apiUpload('/documents/documents/upload', fd);
      setShowDocForm(false); load();
    }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const addCn = async (data) => {
    setSaving(true);
    try { await api.post('/documents/credit-notes', data); setShowCnForm(false); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const delDoc = async (id) => {
    if (!confirm('Delete this document record?')) return;
    try { await api.del(`/documents/documents/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  const docCols = [
    { key: 'title', label: 'Document', render: (d) => <div><div className="font-medium text-gray-900">{d.title}</div><div className="text-xs text-gray-500 capitalize">{d.category}{d.fileName ? ` · 📎 ${d.fileName}` : ''}{d.fileSize ? ` (${(d.fileSize / 1024).toFixed(0)} KB)` : ''}</div></div> },
    { key: 'member', label: 'Member', render: (d) => <span className="text-sm text-gray-600">{d.member?.name || '—'}</span> },
    { key: 'by', label: 'Uploaded by', render: (d) => <span className="text-sm text-gray-600">{d.uploadedBy?.name || '—'}</span> },
    { key: 'date', label: 'Date', render: (d) => <span className="text-xs text-gray-500">{d.createdAt?.slice(0, 10)}</span> },
    {
      key: 'action', label: '', render: (d) => (
        <div className="flex gap-2">
          {d.fileName && <button className="text-xs text-teal-700 hover:text-teal-700" onClick={() => downloadDoc(d)}>Download</button>}
          <button className="text-xs text-red-700 hover:text-red-700" onClick={() => delDoc(d.id)}>Delete</button>
        </div>
      ),
    },
  ];

  const downloadDoc = async (d) => {
    try { await apiDownload(`/documents/documents/${d.id}/download`, d.fileName || d.title); }
    catch (e) { setError(e.message); }
  };
  const cnCols = [
    { key: 'number', label: 'Number', render: (c) => <span className="font-mono text-sm text-gray-600">{c.number}</span> },
    { key: 'member', label: 'Member', render: (c) => <span className="text-sm text-gray-900">{c.member?.name}</span> },
    { key: 'amount', label: 'Amount', render: (c) => <div><div className="text-gray-900 font-medium">{money(c.amount)}</div><div className="text-xs text-gray-500">Used: {money(c.amountUsed)}</div></div> },
    { key: 'status', label: 'Status', render: (c) => <Badge tone={CN_TONES[c.status]}>{c.status}</Badge> },
    { key: 'reason', label: 'Reason', render: (c) => <span className="text-xs text-gray-500">{c.reason || '—'}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Documents & Credits"
        subtitle="Member documents and credit notes"
        action={tab === 'docs'
          ? <button className="btn-primary" onClick={() => setShowDocForm(true)}>+ Add Document</button>
          : <button className="btn-primary" onClick={() => setShowCnForm(true)}>+ Issue Credit Note</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="flex gap-2 mb-3">
        {[['docs', `Documents (${docs.length})`], ['credits', `Credit Notes (${cns.length})`]].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium border ${tab === v ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
            {l}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : tab === 'docs'
        ? <DataTable columns={docCols} rows={docs} emptyText="No documents." />
        : <DataTable columns={cnCols} rows={cns} emptyText="No credit notes." />}
      {showDocForm && <Modal title="Add Document" onClose={() => setShowDocForm(false)}><DocForm members={members} onSave={addDoc} saving={saving} /></Modal>}
      {showCnForm && <Modal title="Issue Credit Note" onClose={() => setShowCnForm(false)}><CnForm members={members} onSave={addCn} saving={saving} /></Modal>}
    </div>
  );
}
