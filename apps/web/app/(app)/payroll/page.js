'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable, StatCard } from '../../../components/ui';

const STATUS_TONE = { draft: 'amber', finalized: 'blue', paid: 'green' };
const STAFF_ROLES = ['ceo', 'admin', 'operations_manager', 'manager', 'finance_officer', 'receptionist', 'office_boy'];

function fmt(n) {
  return 'Rs ' + Number(n || 0).toLocaleString();
}

function StructureForm({ users, onSave, saving }) {
  const [f, setF] = useState({ userId: '', basicSalary: '', allowances: '', deductions: '', effectiveFrom: new Date().toISOString().slice(0, 10) });
  const parsePairs = (s) => {
    const out = {};
    (s || '').split(',').map((p) => p.trim()).filter(Boolean).forEach((p) => {
      const [k, v] = p.split(':').map((x) => x.trim());
      if (k && !isNaN(Number(v))) out[k] = Number(v);
    });
    return out;
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ userId: f.userId, basicSalary: Number(f.basicSalary), allowances: parsePairs(f.allowances), deductions: parsePairs(f.deductions), effectiveFrom: f.effectiveFrom }); }}>
      <Field label="Staff member *">
        <select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} required>
          <option value="">Select user…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
      </Field>
      <Field label="Basic salary (Rs) *"><input type="number" min="0" className="input" value={f.basicSalary} onChange={(e) => setF({ ...f, basicSalary: e.target.value })} required /></Field>
      <Field label="Allowances (name:amount, comma separated)"><input className="input" value={f.allowances} onChange={(e) => setF({ ...f, allowances: e.target.value })} placeholder="transport:5000, housing:10000" /></Field>
      <Field label="Deductions (name:amount, comma separated)"><input className="input" value={f.deductions} onChange={(e) => setF({ ...f, deductions: e.target.value })} placeholder="tax:2000" /></Field>
      <Field label="Effective from *"><input type="date" className="input" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} required /></Field>
      <button className="btn-primary w-full mt-2" disabled={saving}>{saving ? 'Saving…' : 'Save salary'}</button>
    </form>
  );
}

export default function PayrollPage() {
  const [tab, setTab] = useState('runs');
  const [structures, setStructures] = useState([]);
  const [runs, setRuns] = useState([]);
  const [users, setUsers] = useState([]);
  const [runDetail, setRunDetail] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [s, r, u] = await Promise.all([
        api.get('/payroll/structures'),
        api.get('/payroll/runs'),
        api.get('/users').catch(() => ({ users: [] })),
      ]);
      setStructures(s.structures || []);
      setRuns(r.runs || []);
      setUsers((u.users || u || []).filter((x) => STAFF_ROLES.includes(x.role) && x.isActive !== false));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const saveStructure = async (data) => {
    setSaving(true);
    try { await api.post('/payroll/structures', data); setShowForm(false); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const generateRun = async () => {
    setSaving(true); setError('');
    try { await api.post('/payroll/runs', { month }); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const openRun = async (id) => {
    try { const d = await api.get(`/payroll/runs/${id}`); setRunDetail(d.run); }
    catch (e) { setError(e.message); }
  };

  const runAction = async (id, action) => {
    setSaving(true);
    try {
      await api.post(`/payroll/runs/${id}/${action}`);
      const d = await api.get(`/payroll/runs/${id}`);
      setRunDetail(d.run); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const totalPaid = runs.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.totalAmount), 0);

  return (
    <div>
      <PageHeader title="Payroll" sub="Salary structures and monthly payroll runs" actions={
        <>
          {tab === 'structures' && <button className="btn-primary" onClick={() => setShowForm(true)}>+ Set salary</button>}
          {tab === 'runs' && (
            <span className="flex items-center gap-2">
              <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
              <button className="btn-primary" onClick={generateRun} disabled={saving}>Generate run</button>
            </span>
          )}
        </>
      } />
      {error && <ErrorBanner message={error} onRetry={load} />}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Payroll runs" value={runs.length} accent="blue" />
        <StatCard label="Total paid out" value={fmt(totalPaid)} accent="green" />
        <StatCard label="Staff with salary" value={new Set(structures.map((s) => s.userId)).size} accent="violet" />
      </div>
      <div className="flex gap-2 mb-4">
        {['runs', 'structures'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === t ? 'bg-[#7c3aed] text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
            {t === 'runs' ? 'Payroll Runs' : 'Salary Structures'}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : tab === 'runs' ? (
        <DataTable
          columns={['Month', 'Status', 'Payslips', 'Total', '']}
          rows={runs.map((r) => ([
            <span key="m" className="font-semibold text-white">{r.month}</span>,
            <Badge key="s" tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
            r._count?.payslips ?? '—',
            <span key="t" className="font-semibold">{fmt(r.totalAmount)}</span>,
            <button key="v" className="btn-sm btn-ghost" onClick={() => openRun(r.id)}>View</button>,
          ]))}
          empty="No payroll runs yet. Pick a month and Generate run."
        />
      ) : (
        <DataTable
          columns={['Staff', 'Role', 'Basic', 'Allowances', 'Deductions', 'Effective from']}
          rows={structures.map((s) => ([
            <span key="n" className="font-semibold text-white">{s.user?.name}</span>,
            s.user?.role,
            fmt(s.basicSalary),
            fmt(Object.values(s.allowances || {}).reduce((a, v) => a + Number(v), 0)),
            fmt(Object.values(s.deductions || {}).reduce((a, v) => a + Number(v), 0)),
            String(s.effectiveFrom).slice(0, 10),
          ]))}
          empty="No salary structures yet."
        />
      )}
      {showForm && <Modal title="Set salary" onClose={() => setShowForm(false)}><StructureForm users={users} onSave={saveStructure} saving={saving} /></Modal>}
      {runDetail && (
        <Modal title={`Payroll ${runDetail.month}`} onClose={() => setRunDetail(null)}>
          <div className="flex items-center gap-3 mb-4">
            <Badge tone={STATUS_TONE[runDetail.status]}>{runDetail.status}</Badge>
            <span className="text-slate-300 font-semibold">{fmt(runDetail.totalAmount)}</span>
            <span className="flex-1" />
            {runDetail.status === 'draft' && <button className="btn-sm btn-primary" disabled={saving} onClick={() => runAction(runDetail.id, 'finalize')}>Finalize</button>}
            {runDetail.status === 'finalized' && <button className="btn-sm btn-primary" disabled={saving} onClick={() => { if (confirm('Mark as paid? Salary expense entries will be created.')) runAction(runDetail.id, 'mark-paid'); }}>Mark paid</button>}
          </div>
          <DataTable
            columns={['Staff', 'Gross', 'Deductions', 'Net pay', 'Status']}
            rows={(runDetail.payslips || []).map((p) => ([
              <span key="n" className="font-semibold text-white">{p.user?.name}</span>,
              fmt(p.grossSalary),
              fmt(p.totalDeductions),
              <span key="np" className="font-bold text-emerald-300">{fmt(p.netPay)}</span>,
              <Badge key="s" tone={p.status === 'paid' ? 'green' : 'slate'}>{p.status}</Badge>,
            ]))}
            empty="No payslips."
          />
        </Modal>
      )}
    </div>
  );
}
