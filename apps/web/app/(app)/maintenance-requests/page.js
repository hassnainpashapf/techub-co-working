'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal, Field, StatCard } from '../../../components/ui';

const PRIORITY_TONE = { low: 'slate', medium: 'blue', high: 'amber', urgent: 'red' };
const STATUS_TONE = { open: 'blue', in_progress: 'amber', resolved: 'green', closed: 'slate' };

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function MaintenanceRequestsPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'operations_manager', 'office_boy');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (priority) q.set('priority', priority);
    if (search) q.set('search', search);
    api.get(`/maintenance-requests?${q.toString()}`)
      .then((d) => setRows(d.requests || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  const applyFilters = () => { setError(''); load(); };

  const updateRow = async (id, data) => {
    setBusy(true);
    setNote('');
    try {
      const d = await api.patch(`/maintenance-requests/${id}`, data);
      setRows((list) => list.map((r) => (r.id === id ? d.request : r)));
      setSelected(d.request);
      setNote('Updated.');
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (roleLoading) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const open = rows.filter((r) => r.status === 'open').length;
  const inProg = rows.filter((r) => r.status === 'in_progress').length;
  const urgent = rows.filter((r) => r.priority === 'urgent' && !['resolved', 'closed'].includes(r.status)).length;

  return (
    <div>
      <PageHeader title="Maintenance Requests" sub="Fault reports from members" />
      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load(); }} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Open" value={open} accent="blue" />
        <StatCard label="In progress" value={inProg} accent="amber" />
        <StatCard label="Urgent (pending)" value={urgent} accent="red" />
        <StatCard label="Total" value={rows.length} accent="slate" />
      </div>
      <div className="card-premium p-4 mb-3 flex flex-wrap gap-3 items-end">
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">All</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
        <Field label="Search">
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, location…" />
        </Field>
        <button className="btn-primary" onClick={applyFilters}>Apply</button>
      </div>
      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="No requests" hint="No maintenance requests match the current filters." />
      ) : (
        <div className="overflow-x-auto card-premium p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="p-3">Title</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Status</th>
                <th className="p-3">Reporter</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Reported</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-200 hover:bg-gray-100">
                  <td className="p-3">
                    <div className="font-semibold text-gray-900">{r.title}</div>
                    <div className="text-xs text-gray-500">{r.location || r.unit?.code || ''}</div>
                  </td>
                  <td className="p-3"><Badge tone={PRIORITY_TONE[r.priority] || 'slate'}>{r.priority}</Badge></td>
                  <td className="p-3"><Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status.replace('_', ' ')}</Badge></td>
                  <td className="p-3 text-gray-600">{r.member?.name || r.reportedBy?.name || '—'}</td>
                  <td className="p-3 text-gray-600">{r.assignedTo?.name || '—'}</td>
                  <td className="p-3 text-gray-500 text-xs">{fmtDate(r.createdAt)}</td>
                  <td className="p-3"><button className="btn-ghost text-xs" onClick={() => { setSelected(r); setNote(''); }}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          {note && <p className="text-sm text-gray-600 mb-3">{note}</p>}
          {selected.description && <p className="text-sm text-gray-600 whitespace-pre-wrap mb-3">{selected.description}</p>}
          <div className="grid grid-cols-2 gap-3 text-sm mb-3">
            <div><span className="text-slate-500">Priority:</span> <Badge tone={PRIORITY_TONE[selected.priority]}>{selected.priority}</Badge></div>
            <div><span className="text-slate-500">Status:</span> <Badge tone={STATUS_TONE[selected.status]}>{selected.status.replace('_', ' ')}</Badge></div>
            <div><span className="text-slate-500">Location:</span> <span className="text-gray-800">{selected.location || '—'}</span></div>
            <div><span className="text-slate-500">Unit:</span> <span className="text-gray-800">{selected.unit?.code || '—'}</span></div>
            <div><span className="text-slate-500">Reporter:</span> <span className="text-gray-800">{selected.member?.name || selected.reportedBy?.name || '—'}</span></div>
            <div><span className="text-slate-500">Assigned:</span> <span className="text-gray-800">{selected.assignedTo?.name || '—'}</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Field label="Status">
              <select className="input" value={selected.status} disabled={busy}
                onChange={(e) => updateRow(selected.id, { status: e.target.value })}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={selected.priority} disabled={busy}
                onChange={(e) => updateRow(selected.id, { priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Assign to (user ID)">
              <input className="input" defaultValue={selected.assignedTo?.id || ''} disabled={busy} placeholder="User ID, empty = unassign"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if ((v || null) !== (selected.assignedTo?.id || null)) updateRow(selected.id, { assignedToId: v || null });
                }} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
