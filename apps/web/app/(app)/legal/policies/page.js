'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, DataTable, Modal, Field, Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'house-rules', label: 'House Rules' },
  { value: 'safety', label: 'Safety' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'hr', label: 'HR' },
  { value: 'finance', label: 'Finance' },
  { value: 'it', label: 'IT & Systems' },
];

const emptyForm = { title: '', category: 'general', fileUrl: '', body: '', effectiveDate: '', requiresAck: true, reAckOnUpdate: false, isActive: true };

function AckBar({ acked, total }) {
  const pct = total > 0 ? Math.round((acked / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-slate-700/60 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-[#0f766e] to-teal-600" style={{ width: pct + '%' }} />
      </div>
      <span className="text-xs text-gray-600 whitespace-nowrap">{acked}/{total}</span>
    </div>
  );
}

export default function PoliciesPage() {
  const { loading: roleLoading, allowed } = useRequireRoles(['ceo', 'admin', 'super_admin', 'manager']);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [acksModal, setAcksModal] = useState(null);
  const [acks, setAcks] = useState([]);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await api.get('/policies');
      setPolicies(d.policies || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  const openNew = () => { setEditing(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      title: p.title, category: p.category, fileUrl: p.fileUrl || '', body: p.body || '',
      effectiveDate: p.effectiveDate ? p.effectiveDate.slice(0, 10) : '',
      requiresAck: p.requiresAck, reAckOnUpdate: p.reAckOnUpdate, isActive: p.isActive,
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) { setMsg('Title lazmi hai.'); return; }
    setSaving(true); setMsg('');
    try {
      const payload = {
        ...form,
        fileUrl: form.fileUrl || null,
        body: form.body || null,
        effectiveDate: form.effectiveDate ? new Date(form.effectiveDate).toISOString() : null,
      };
      if (editing) {
        const bump = editing.body !== form.body || editing.fileUrl !== (form.fileUrl || null);
        await api.patch(`/policies/${editing.id}`, { ...payload, bumpVersion: bump });
      } else {
        await api.post('/policies', payload);
      }
      setShowModal(false); await load();
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (p) => {
    if (!window.confirm(`"${p.title}" delete karein?`)) return;
    try { await api.del(`/policies/${p.id}`); await load(); }
    catch (e) { setError(e.message); }
  };

  const viewAcks = async (p) => {
    setAcksModal(p);
    try {
      const d = await api.get(`/policies/${p.id}/acks`);
      setAcks(d.acks || []);
    } catch (e) { setAcks([]); setError(e.message); }
  };

  const remind = async (p) => {
    try {
      const d = await api.post(`/policies/${p.id}/remind`, {});
      setMsg(`${d.pending} pending — ${d.notified} members ko reminder bhej diya.`);
      setTimeout(() => setMsg(''), 4000);
    } catch (e) { setError(e.message); }
  };

  if (roleLoading) return <div className="p-5"><Spinner /></div>;
  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="p-5"><Spinner /></div>;

  return (
    <div className="p-6 space-y-3">
      <PageHeader title="📋 Policy Documents" subtitle="Policies + member acknowledgments" actions={
        <button onClick={openNew} className="btn-primary">+ Nayi Policy</button>
      } />
      {error && <ErrorBanner message={error} />}
      {msg && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">{msg}</div>}

      <DataTable
        columns={[
          { key: 'title', label: 'Title', render: (p) => <div><div className="font-medium text-gray-900">{p.title}</div><div className="text-xs text-gray-500">v{p.version} · {CATEGORIES.find(c => c.value === p.category)?.label || p.category}</div></div> },
          { key: 'ack', label: 'Acknowledgments', render: (p) => p.requiresAck ? <AckBar acked={p.acked} total={p.totalMembers} /> : <span className="text-xs text-slate-500">n/a</span> },
          { key: 'status', label: 'Status', render: (p) => <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: 'actions', label: '', render: (p) => (
            <div className="flex gap-2 justify-end">
              <button onClick={() => viewAcks(p)} className="btn-ghost text-xs">Acks</button>
              <button onClick={() => remind(p)} className="btn-ghost text-xs">🔔 Remind</button>
              <button onClick={() => openEdit(p)} className="btn-ghost text-xs">Edit</button>
              <button onClick={() => remove(p)} className="btn-ghost text-xs text-red-700">Delete</button>
            </div>
          ) },
        ]}
        rows={policies}
        emptyText="Koi policy nahi — pehli policy banayein."
      />

      {showModal && (
        <Modal title={editing ? 'Policy Edit karein' : 'Nayi Policy'} onClose={() => setShowModal(false)}>
          <div className="space-y-3">
            <Field label="Title"><input className="input-premium" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="input-premium" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Effective Date"><input type="date" className="input-premium" value={form.effectiveDate} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} /></Field>
            </div>
            <Field label="File URL (optional)"><input className="input-premium" placeholder="https://..." value={form.fileUrl} onChange={e => setForm({ ...form, fileUrl: e.target.value })} /></Field>
            <Field label="Policy Text (optional)"><textarea className="input-premium" rows={6} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></Field>
            <div className="flex gap-3 text-sm text-gray-800">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.requiresAck} onChange={e => setForm({ ...form, requiresAck: e.target.checked })} /> Ack lazmi</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.reAckOnUpdate} onChange={e => setForm({ ...form, reAckOnUpdate: e.target.checked })} /> Update par dobara ack</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
            </div>
            {msg && <div className="text-sm text-red-700">{msg}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {acksModal && (
        <Modal title={`Acks — ${acksModal.title}`} onClose={() => setAcksModal(null)}>
          <div className="space-y-2 max-h-[60vh] overflow-auto">
            {acks.length === 0 && <div className="text-sm text-gray-500">Abhi kisi ne ack nahi kiya.</div>}
            {acks.map(a => (
              <div key={a.id} className="flex justify-between text-sm bg-gray-100/50 rounded-lg px-3 py-2">
                <span className="text-gray-900">{a.member?.name || a.user?.name || '—'} <span className="text-gray-500 text-xs">{a.member?.email || a.user?.email || ''}</span></span>
                <span className="text-gray-500 text-xs">{new Date(a.ackedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
