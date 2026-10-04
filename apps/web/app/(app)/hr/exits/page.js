'use client';

// Phase 42 Track 8: Exit / Offboarding Process.
// Exit pipeline + clearance progress + final settlement summary.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const TYPES = [
  { value: 'resignation', label: 'Resignation', tone: 'blue' },
  { value: 'termination', label: 'Termination', tone: 'red' },
];
const STATUSES = [
  { value: 'initiated', label: 'Initiated', tone: 'amber' },
  { value: 'clearance_pending', label: 'Clearance pending', tone: 'blue' },
  { value: 'completed', label: 'Completed', tone: 'green' },
];

function typeBadge(t) {
  const x = TYPES.find((y) => y.value === t) || TYPES[0];
  return <Badge tone={x.tone}>{x.label}</Badge>;
}
function statusBadge(s) {
  const x = STATUSES.find((y) => y.value === s) || STATUSES[0];
  return <Badge tone={x.tone}>{x.label}</Badge>;
}

export default function ExitsPage() {
  const [exits, setExits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ employeeId: '', type: 'resignation', lastWorkingDay: '', reason: '', noticeDays: '' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (search) qs.set('search', search);
      const r = await api.get(`/exits?${qs.toString()}`);
      setExits(r.items || []);
    } catch (e) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const openModal = async () => {
    try {
      const r = await api.get('/employees?status=active');
      setEmployees((r.items || []).filter((e) => e.status === 'active'));
    } catch { setEmployees([]); }
    setForm({ employeeId: '', type: 'resignation', lastWorkingDay: '', reason: '', noticeDays: '' });
    setShowModal(true);
  };

  const initiate = async () => {
    if (!form.employeeId || !form.lastWorkingDay) { setError('Employee aur last working day lazmi hai'); return; }
    try {
      await api.post('/exits/initiate', {
        employeeId: form.employeeId,
        type: form.type,
        lastWorkingDay: form.lastWorkingDay,
        reason: form.reason || undefined,
        noticeDays: form.noticeDays ? Number(form.noticeDays) : undefined,
      });
      setShowModal(false);
      load();
    } catch (e) { setError(e.message || 'Initiate failed'); }
  };

  const openDetail = async (id) => {
    try {
      const r = await api.get(`/exits/${id}`);
      setDetail(r);
    } catch (e) { setError(e.message || 'Detail load nahi hua'); }
  };

  const clearItem = async (index) => {
    if (!detail) return;
    try {
      const r = await api.post(`/exits/${detail.exit.id}/clear`, { index });
      setDetail(await api.get(`/exits/${detail.exit.id}`));
      load();
    } catch (e) { setError(e.message || 'Clear failed'); }
  };

  const complete = async () => {
    if (!detail) return;
    if (!confirm('Exit complete karna hai? Employee exited ho jayega aur login deactivate ho jayega.')) return;
    try {
      await api.post(`/exits/${detail.exit.id}/complete`);
      setDetail(await api.get(`/exits/${detail.exit.id}`));
      load();
    } catch (e) { setError(e.message || 'Complete failed'); }
  };

  const cols = [
    { key: 'name', label: 'Employee', render: (x) => x.employee?.name || '—' },
    { key: 'designation', label: 'Designation', render: (x) => x.employee?.designation || '—' },
    { key: 'type', label: 'Type', render: (x) => typeBadge(x.type) },
    { key: 'lastWorkingDay', label: 'Last day', render: (x) => x.lastWorkingDay ? new Date(x.lastWorkingDay).toLocaleDateString() : '—' },
    { key: 'status', label: 'Status', render: (x) => statusBadge(x.status) },
    { key: 'initiatedAt', label: 'Initiated', render: (x) => new Date(x.initiatedAt).toLocaleDateString() },
  ];

  const pending = exits.filter((x) => x.status !== 'completed').length;

  return (
    <div>
      <PageHeader title="Exits & Offboarding" subtitle="Clearance checklist, final settlement aur account deactivation" action={
        <button onClick={openModal} className="btn-primary">+ Initiate exit</button>
      } />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Total exits" value={exits.length} />
        <StatCard label="In progress" value={pending} />
        <StatCard label="Completed" value={exits.filter((x) => x.status === 'completed').length} />
        <StatCard label="Resignations" value={exits.filter((x) => x.type === 'resignation').length} />
      </div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee…" className="input" />
        <button onClick={load} className="btn-secondary">Search</button>
      </div>
      {loading ? <Spinner /> : exits.length === 0 ? <EmptyState title="Koi exit nahi" /> :
        <DataTable columns={cols} rows={exits} onRowClick={(x) => openDetail(x.id)} />}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Initiate exit">
        <div className="space-y-3">
          <Field label="Employee">
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="input">
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.designation}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Last working day">
            <input type="date" value={form.lastWorkingDay} onChange={(e) => setForm({ ...form, lastWorkingDay: e.target.value })} className="input" />
          </Field>
          <Field label="Notice days (optional)">
            <input type="number" min="0" value={form.noticeDays} onChange={(e) => setForm({ ...form, noticeDays: e.target.value })} className="input" />
          </Field>
          <Field label="Reason (optional)">
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="input" rows={3} />
          </Field>
          <button onClick={initiate} className="btn-primary w-full">Initiate + clearance checklist</button>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Exit detail" wide>
        {detail && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div>
                <div className="font-semibold text-lg">{detail.exit.employee?.name}</div>
                <div className="text-sm text-gray-500">{detail.exit.employee?.designation} · {detail.exit.employee?.department}</div>
              </div>
              <div className="ml-auto flex gap-2">{typeBadge(detail.exit.type)}{statusBadge(detail.exit.status)}</div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Clearance</span>
                <span>{detail.clearanceProgress.done}/{detail.clearanceProgress.total} done</span>
              </div>
              <div className="h-2 bg-slate-700 rounded">
                <div className="h-2 bg-green-500 rounded" style={{ width: detail.clearanceProgress.total ? `${(detail.clearanceProgress.done / detail.clearanceProgress.total) * 100}%` : '0%' }} />
              </div>
            </div>
            <div className="space-y-2">
              {(Array.isArray(detail.exit.clearanceItems) ? detail.exit.clearanceItems : []).map((it, i) => (
                <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${it.done ? 'border-green-500/30 bg-green-500/5' : 'border-gray-200'}`}>
                  <input type="checkbox" checked={!!it.done} disabled={!!it.done || detail.exit.status === 'completed'}
                    onChange={() => clearItem(i)} className="w-5 h-5" />
                  <div className="flex-1">
                    <div className={it.done ? 'line-through text-gray-500' : ''}>{it.title}</div>
                    <div className="text-xs text-slate-500">{it.dept}{it.doneAt ? ` · ${new Date(it.doneAt).toLocaleDateString()}` : ''}</div>
                  </div>
                  <Badge tone="slate">{it.dept}</Badge>
                </div>
              ))}
            </div>
            <div className="p-4 rounded-lg bg-gray-100/60 border border-gray-200">
              <div className="font-semibold mb-2">Final settlement</div>
              {detail.settlement && detail.settlement.advances.length === 0
                ? <div className="text-sm text-gray-500">Koi pending advance/loan nahi.</div>
                : detail.settlement.advances.map((a) => (
                  <div key={a.id} className="flex justify-between text-sm py-1">
                    <span className="capitalize">{a.type}</span>
                    <span className="text-amber-400">Rs {a.pending.toLocaleString()} pending</span>
                  </div>
                ))}
            </div>
            {detail.exit.status !== 'completed' && (
              <button onClick={complete} className="btn-primary w-full">Complete exit (deactivate login)</button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
