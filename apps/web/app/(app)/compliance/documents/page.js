'use client';

// Phase 38 Track 7: Document Expiry Tracking (Compliance)
import { useEffect, useState } from 'react';
import { api, apiUpload } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, StatCard } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const STATUS_TONE = { valid: 'green', expiring: 'amber', expired: 'red', none: 'slate' };
const DOC_CATS = ['contract', 'id', 'invoice', 'policy', 'trade_license', 'cnic', 'other'];

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysText(d, status) {
  if (status === 'none') return 'No expiry';
  if (status === 'expired') return `${Math.abs(d)} days overdue`;
  if (d === 0) return 'Expires today';
  if (d === 1) return '1 day left';
  return `${d} days left`;
}

function DocForm({ members, onSave, saving }) {
  const [f, setF] = useState({
    title: '', category: 'trade_license', memberId: '', notes: '',
    issuedAt: '', expiresAt: '', reminderDays: '30,7,1',
  });
  const [file, setFile] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const reminders = f.reminderDays.split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => !isNaN(x) && x >= 0);
    onSave({ ...f, memberId: f.memberId || null, issuedAt: f.issuedAt || null, expiresAt: f.expiresAt || null, reminderDays: reminders, file });
  };
  return (
    <form onSubmit={submit}>
      <Field label="Title *"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Trade License 2026" required /></Field>
      <Field label="File *">
        <input type="file" className="input file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-teal-600/20 file:text-violet-700 file:text-xs"
          onChange={(e) => setFile(e.target.files?.[0] || null)} required
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt" />
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Document type">
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {DOC_CATS.map((c) => <option key={c} value={c} className="capitalize">{c.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Member (optional)">
          <select className="input" value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })}>
            <option value="">— Space / company doc —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Issued date">
          <input type="date" className="input [color-scheme:dark]" value={f.issuedAt} onChange={(e) => setF({ ...f, issuedAt: e.target.value })} />
        </Field>
        <Field label="Expiry date *">
          <input type="date" className="input [color-scheme:dark]" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} required />
        </Field>
      </div>
      <Field label="Reminder days (comma separated)">
        <input className="input" value={f.reminderDays} onChange={(e) => setF({ ...f, reminderDays: e.target.value })} placeholder="30,7,1" />
        <p className="text-[11px] text-slate-500 mt-1">Email reminders go to the member + admins on these days before expiry.</p>
      </Field>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="flex justify-end gap-2 mt-2">
        <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Add document'}</button>
      </div>
    </form>
  );
}

export default function ComplianceDocumentsPage() {
  const gate = useRequireRoles('ceo', 'admin', 'manager');
  const [docs, setDocs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [d, e] = await Promise.all([
        api.get('/documents/documents'),
        api.get('/documents/documents/expiring?days=30').catch(() => ({ documents: [] })),
      ]);
      setDocs(d.documents || []);
      setAlerts(e.documents || []);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api.get('/members?limit=500').then((d) => setMembers(d.members || [])).catch(() => {});
  }, []);

  async function save(form) {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', form.file);
      fd.append('title', form.title);
      fd.append('category', form.category);
      if (form.memberId) fd.append('memberId', form.memberId);
      if (form.notes) fd.append('notes', form.notes);
      if (form.issuedAt) fd.append('issuedAt', new Date(form.issuedAt).toISOString());
      if (form.expiresAt) fd.append('expiresAt', new Date(form.expiresAt).toISOString());
      fd.append('reminderDays', JSON.stringify(form.reminderDays));
      await apiUpload('/documents/documents/upload', fd);
      setShowAdd(false);
      load();
    } catch (err) {
      alert(err.message || 'Upload failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this document?')) return;
    try {
      await api.del(`/documents/documents/${id}`);
      load();
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  }

  if (gate.loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!gate.allowed) return <AccessDenied />;

  const counts = {
    expiring: docs.filter((d) => d.expiryStatus === 'expiring').length,
    expired: docs.filter((d) => d.expiryStatus === 'expired').length,
    valid: docs.filter((d) => d.expiryStatus === 'valid').length,
  };

  return (
    <div>
      <PageHeader
        title="Document Expiry Tracking"
        sub="Trade licenses, CNICs, contracts — renewals par automatic email reminders"
        actions={<button onClick={() => setShowAdd(true)} className="btn-primary">+ Add document</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Expiring soon" value={counts.expiring} accent="amber" />
        <StatCard label="Expired" value={counts.expired} accent="red" />
        <StatCard label="Valid" value={counts.valid} accent="emerald" />
      </div>

      {alerts.length > 0 && (
        <div className="card-premium p-5 mb-6 border-l-4 border-l-amber-400">
          <h2 className="text-gray-900 font-bold mb-3">⚠️ Expiring in 30 days</h2>
          <div className="space-y-2">
            {alerts.map((d) => (
              <div key={d.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                <div>
                  <p className="text-gray-900 text-sm font-medium">{d.title}</p>
                  <p className="text-gray-500 text-xs">{d.member?.name || 'Space doc'} • expires {fmtDate(d.expiresAt)}</p>
                </div>
                <Badge tone={STATUS_TONE[d.expiryStatus]}>{daysText(d.daysLeft, d.expiryStatus)}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-premium p-5">
        <h2 className="text-gray-900 font-bold mb-4">All tracked documents</h2>
        {loading ? <div className="flex justify-center py-10"><Spinner /></div> : docs.length === 0 ? (
          <p className="text-gray-500 text-sm">No documents with expiry tracking yet. Click "Add document" to start.</p>
        ) : (
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <div className="min-w-0">
                  <p className="text-gray-900 text-sm font-medium truncate">{d.title}</p>
                  <p className="text-gray-500 text-xs capitalize">
                    {String(d.category || '').replace('_', ' ')} • {d.member?.name || 'Space doc'} • expires {fmtDate(d.expiresAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={STATUS_TONE[d.expiryStatus] || 'slate'}>{daysText(d.daysLeft, d.expiryStatus)}</Badge>
                  <button onClick={() => remove(d.id)} className="text-xs text-red-700 hover:text-red-700 border border-red-200 rounded-lg px-2.5 py-1">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <Modal title="Add tracked document" onClose={() => setShowAdd(false)}>
          <DocForm members={members} onSave={save} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
