'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'operations_manager', 'office_boy'];
const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', 'one-time': 'One-time' };
const STATUS_TONE = { pending: 'amber', done: 'green', skipped: 'slate' };

function isOverdue(t) {
  if (t.status !== 'pending' || !t.dueDate) return false;
  return new Date(t.dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
}

function fmtDue(s) {
  if (!s) return 'No due date';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function TaskForm({ initial, onSave, saving, canAssign }) {
  const [f, setF] = useState({
    title: initial?.title || '',
    area: initial?.area || '',
    frequency: initial?.frequency || 'one-time',
    dueDate: initial?.dueDate ? initial.dueDate.slice(0, 16) : '',
    description: initial?.description || '',
  });
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({ ...f, dueDate: f.dueDate ? new Date(f.dueDate).toISOString() : null });
    }}>
      <Field label="Task *"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={200} placeholder="e.g. Clean lobby washrooms" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Area"><input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Lobby / Floor 2" /></Field>
        <Field label="Frequency">
          <select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            <option value="one-time">One-time</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
      </div>
      <Field label="Due"><input type="datetime-local" className="input" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      <Field label="Notes"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save task'}</button>
    </form>
  );
}

export default function HousekeepingPage() {
  const gate = useRequireRoles(...ROLES);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('today'); // today | all | done
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [staff, setStaff] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const q = filter === 'today' ? '?due=today' : filter === 'done' ? '?status=done' : '';
      const { tasks } = await api.get('/housekeeping' + q);
      setTasks(tasks || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (gate === 'ok') { load(); setStaff(true); } }, [gate, filter]);

  const create = async (data) => {
    setSaving(true);
    try { await api.post('/housekeeping', data); setShowForm(false); load(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const complete = async (id) => {
    setCompleting(id);
    try { await api.post(`/housekeeping/${id}/complete`, {}); load(); }
    catch (e) { setError(e.message); }
    finally { setCompleting(null); }
  };

  const generate = async () => {
    try {
      const { created } = await api.post('/housekeeping/generate', {});
      load();
      alert(`${created} recurring task(s) generated for today.`);
    } catch (e) { setError(e.message); }
  };

  if (gate === 'loading') return <Spinner />;
  if (gate === 'denied') return <AccessDenied />;

  const pending = tasks.filter((t) => t.status === 'pending');
  const overdue = tasks.filter(isOverdue);
  const doneToday = tasks.filter((t) => t.status === 'done');

  return (
    <div>
      <PageHeader title="Housekeeping" subtitle="Cleaning schedule & daily checklist">
        <button className="btn-secondary" onClick={generate}>↻ Generate today's recurring</button>
        <button className="btn-primary" onClick={() => setShowForm(true)}>+ New task</button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Pending" value={pending.length} accent="amber" />
        <StatCard label="Overdue" value={overdue.length} accent="red" />
        <StatCard label="Done today" value={doneToday.length} accent="green" />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2 mb-4">
        {[['today', "Today's checklist"], ['all', 'All pending'], ['done', 'Completed']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${filter === k ? 'bg-[#7c3aed] text-white' : 'bg-white/5 text-slate-300 border border-white/10'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : tasks.length === 0 ? (
        <EmptyState title="No tasks" text={filter === 'today' ? 'Nothing scheduled for today.' : 'No tasks found.'} />
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <div key={t.id}
              className={`card-premium p-4 flex items-center gap-4 ${isOverdue(t) ? 'border-red-500/50' : ''}`}>
              <button
                onClick={() => t.status === 'pending' && complete(t.id)}
                disabled={t.status !== 'pending' || completing === t.id}
                className={`shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center text-lg transition
                  ${t.status === 'done' ? 'bg-emerald-500 border-emerald-500 text-white'
                    : isOverdue(t) ? 'border-red-500 text-red-400 hover:bg-red-500/10'
                    : 'border-white/20 text-transparent hover:border-emerald-400'}`}>
                ✓
              </button>
              <div className="flex-1 min-w-0">
                <div className={`font-semibold ${t.status === 'done' ? 'line-through text-slate-400' : 'text-white'}`}>
                  {t.title}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {t.area || t.unit?.code || 'General'} · {FREQ_LABEL[t.frequency] || t.frequency} · {fmtDue(t.dueDate)}
                  {t.assignedTo ? ` · 👷 ${t.assignedTo.name}` : ''}
                </div>
              </div>
              {isOverdue(t) && <Badge tone="red">Overdue</Badge>}
              <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
            </div>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New cleaning task">
        <TaskForm onSave={create} saving={saving} />
      </Modal>
    </div>
  );
}
