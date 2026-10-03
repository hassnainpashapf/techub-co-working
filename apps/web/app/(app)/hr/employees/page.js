'use client';

// Phase 42 Track 1: Employee Directory.
// HR employees list + profile modal (tabs: info, documents — track 9 extend karega).
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';
import EmployeeDocumentsTab from '../../../../components/EmployeeDocumentsTab';

const DEPARTMENTS = [
  { value: 'ops', label: 'Operations' },
  { value: 'finance', label: 'Finance' },
  { value: 'sales', label: 'Sales' },
  { value: 'admin', label: 'Admin' },
  { value: 'support', label: 'Support' },
];
const TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
];

// Phase 43 Track 8: employee ko café role assign/remove
function CafeRoleTab({ employeeId }) {
  const [staff, setStaff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('chef');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/cafe-staff');
      const list = data.staff || data.cafeStaff || [];
      setStaff(list.find((s) => (s.employee && s.employee.id === employeeId) || s.employeeId === employeeId) || null);
      setError('');
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Load nahi hua');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [employeeId]);

  const assign = async () => {
    setBusy(true);
    try {
      await api.post('/cafe-staff/assign', { employeeId, role });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Assign fail ho gaya');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.post(`/cafe-staff/${staff.id}/deactivate`);
      await load();
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Remove fail ho gaya');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  return (
    <div className="space-y-3 text-sm">
      {error && <ErrorBanner message={error} onRetry={load} />}
      {staff && staff.isActive ? (
        <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-4 py-3">
          <div>
            <div className="font-semibold text-slate-200 capitalize">🧑‍🍳 {staff.role}</div>
            <div className="text-xs text-slate-400">Café staff — kitchen display access hai</div>
          </div>
          <button onClick={remove} disabled={busy} className="btn-ghost text-red-300 text-sm">Remove</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
            <option value="chef">Chef</option>
            <option value="cashier">Cashier</option>
            <option value="runner">Runner</option>
          </select>
          <button onClick={assign} disabled={busy} className="btn-primary text-sm">{busy ? '…' : 'Assign café role'}</button>
        </div>
      )}
    </div>
  );
}
const STATUSES = [
  { value: 'active', label: 'Active', tone: 'green' },
  { value: 'on_leave', label: 'On leave', tone: 'amber' },
  { value: 'exited', label: 'Exited', tone: 'slate' },
];

const emptyForm = {
  name: '', email: '', phone: '', department: 'ops', designation: 'Staff',
  joiningDate: '', employmentType: 'full_time', status: 'active',
  emergencyContact: '', cnic: '', address: '',
};

function deptLabel(v) { return (DEPARTMENTS.find((d) => d.value === v) || {}).label || v; }
function statusBadge(s) {
  const st = STATUSES.find((x) => x.value === s) || STATUSES[0];
  return <Badge tone={st.tone}>{st.label}</Badge>;
}

export default function EmployeesPage() {
  const [emps, setEmps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState(null); // null | 'add' | emp
  const [profile, setProfile] = useState(null); // selected employee for profile
  const [ptab, setPtab] = useState('info'); // info | documents (track 9)
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (dept !== 'all') q.set('department', dept);
      if (status !== 'all') q.set('status', status);
      const data = await api.get('/employees?' + q.toString());
      setEmps(data.items || []);
    } catch (e) {
      setError(e.message || 'Employees load nahi ho sake');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); }, [search, dept, status]);

  function openAdd() { setForm({ ...emptyForm, joiningDate: new Date().toISOString().slice(0, 10) }); setModal('add'); }
  function openEdit(e) {
    setForm({
      name: e.name || '', email: e.email || '', phone: e.phone || '',
      department: e.department || 'ops', designation: e.designation || 'Staff',
      joiningDate: e.joiningDate ? String(e.joiningDate).slice(0, 10) : '',
      employmentType: e.employmentType || 'full_time', status: e.status || 'active',
      emergencyContact: e.emergencyContact || '', cnic: e.cnic || '', address: e.address || '',
    });
    setModal(e);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = { ...form, joiningDate: form.joiningDate || undefined };
      if (modal === 'add') await api.post('/employees', payload);
      else await api.patch('/employees/' + modal.id, payload);
      setModal(null);
      load();
      if (profile && modal !== 'add' && modal.id === profile.id) setProfile({ ...profile, ...payload });
    } catch (e) {
      setError(e.message || 'Save nahi ho saka');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(e, newStatus) {
    if (!confirm(`${e.name} ka status "${newStatus}" karna hai?`)) return;
    try {
      await api.patch('/employees/' + e.id + '/status', { status: newStatus });
      setProfile(null);
      load();
    } catch (err) {
      setError(err.message || 'Status update nahi ho saka');
    }
  }

  const active = emps.filter((e) => e.status === 'active');

  const columns = [
    { key: 'name', label: 'Employee', render: (e) => (
      <button className="link font-medium" onClick={() => { setProfile(e); setPtab('info'); }}>
        {e.name}
      </button>
    ) },
    { key: 'designation', label: 'Designation', render: (e) => <span className="text-slate-300">{e.designation}</span> },
    { key: 'department', label: 'Department', render: (e) => <Badge tone="blue">{deptLabel(e.department)}</Badge> },
    { key: 'phone', label: 'Phone', render: (e) => <span className="text-slate-300">{e.phone || '—'}</span> },
    { key: 'status', label: 'Status', render: (e) => statusBadge(e.status) },
    { key: 'actions', label: '', render: (e) => (
      <div className="flex gap-2 justify-end">
        <button className="btn-sm" onClick={() => openEdit(e)}>✏️</button>
        {e.status !== 'active' && <button className="btn-sm" onClick={() => changeStatus(e, 'active')}>✅ Active</button>}
        {e.status === 'active' && <button className="btn-sm" onClick={() => changeStatus(e, 'exited')}>🚪 Exit</button>}
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="HR employee directory — profiles, departments, aur employment status"
        action={<button className="btn-primary" onClick={openAdd}>+ Naya Employee</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="grid-4 mb-4">
        <StatCard title="Total Employees" value={emps.length} />
        <StatCard title="Active" value={active.length} />
        <StatCard title="Departments" value={new Set(emps.map((e) => e.department)).size} />
        <StatCard title="On Leave" value={emps.filter((e) => e.status === 'on_leave').length} />
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input max-w-xs" placeholder="🔍 Naam, email, designation..."
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input max-w-[180px]" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="all">Sab departments</option>
            {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select className="input max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Sab statuses</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? <Spinner /> : emps.length === 0
        ? <EmptyState title="Koi employee nahi mila" hint="Pehla employee add karein." />
        : <DataTable columns={columns} rows={emps} />}

      {modal && (
        <Modal title={modal === 'add' ? 'Naya Employee' : 'Employee Edit — ' + modal.name} onClose={() => setModal(null)}>
          <div className="grid-2 gap-3">
            <Field label="Naam *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Designation"><input className="input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Department">
              <select className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="Employment type">
              <select className="input" value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Joining date"><input className="input" type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} /></Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Emergency contact"><input className="input" value={form.emergencyContact} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} /></Field>
            <Field label="CNIC"><input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} /></Field>
            <Field label="Address" className="col-span-2"><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {profile && (
        <Modal title={'👤 ' + profile.name} onClose={() => setProfile(null)}>
          <div className="flex gap-2 mb-4">
            <button className={ptab === 'info' ? 'btn-sm btn-primary' : 'btn-sm'} onClick={() => setPtab('info')}>Info</button>
            <button className={ptab === 'documents' ? 'btn-sm btn-primary' : 'btn-sm'} onClick={() => setPtab('documents')}>Documents</button>
            <button className={ptab === 'cafe' ? 'btn-sm btn-primary' : 'btn-sm'} onClick={() => setPtab('cafe')}>Café Role</button>
          </div>
          {ptab === 'info' && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Designation</span><span className="text-slate-200">{profile.designation}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Department</span><span className="text-slate-200">{deptLabel(profile.department)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Status</span>{statusBadge(profile.status)}</div>
              <div className="flex justify-between"><span className="text-slate-400">Employment</span><span className="text-slate-200">{(TYPES.find((t) => t.value === profile.employmentType) || {}).label}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Email</span><span className="text-slate-200">{profile.email || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Phone</span><span className="text-slate-200">{profile.phone || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Joining</span><span className="text-slate-200">{profile.joiningDate ? String(profile.joiningDate).slice(0, 10) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Emergency</span><span className="text-slate-200">{profile.emergencyContact || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">CNIC</span><span className="text-slate-200">{profile.cnic || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Address</span><span className="text-slate-200">{profile.address || '—'}</span></div>
            </div>
          )}
          {ptab === 'documents' && (
            <EmployeeDocumentsTab employeeId={profile.id} />
          )}
          {ptab === 'cafe' && (
            <CafeRoleTab employeeId={profile.id} />
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-ghost" onClick={() => { openEdit(profile); setProfile(null); }}>✏️ Edit</button>
            <button className="btn-ghost" onClick={() => setProfile(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
