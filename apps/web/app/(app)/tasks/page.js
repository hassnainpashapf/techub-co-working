'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
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

const STATUS_TONE = { pending: 'amber', in_progress: 'blue', done: 'green' };
const PRIORITY_TONE = { low: 'slate', medium: 'blue', high: 'amber', urgent: 'red' };
const NEXT_STATUS = { pending: 'in_progress', in_progress: 'done', done: 'done' };
const NEXT_LABEL = { pending: 'Start', in_progress: 'Mark done', done: 'Done' };

function TaskForm({ initial, users, onSave, saving }) {
  const [form, setForm] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    assigneeId: initial?.assigneeId || initial?.assignee?.id || '',
    priority: initial?.priority || 'medium',
    dueDate: initial?.dueDate ? String(initial.dueDate).slice(0, 10) : '',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...form, assigneeId: form.assigneeId || undefined });
      }}
    >
      <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
      <Field label="Description"><textarea className="input" rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Assign to">
          <select className="input" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
      </div>
      <Field label="Due date"><input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save task'}</button>
    </form>
  );
}

export default function TasksPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'office_boy');
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', data}
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const [t, u] = await Promise.all([
        api.get('/tasks'),
        api.get('/users').catch(() => ({ users: [] })),
      ]);
      setTasks(t.tasks || t || []);
      setUsers(u.users || u || []);
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

  const filtered = useMemo(() => {
    let list = tasks;
    if (user?.role === 'office_boy') {
      list = list.filter((t) => t.assigneeId === user.id || t.assignee?.id === user.id);
    }
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);
    return list;
  }, [tasks, statusFilter, user]);

  async function handleSave(payload) {
    setSaving(true);
    try {
      if (modal.mode === 'add') await api.post('/tasks', payload);
      else await api.put(`/tasks/${modal.data.id}`, payload);
      setModal(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function advance(id, currentStatus) {
    const next = NEXT_STATUS[currentStatus] || 'in_progress';
    try {
      await api.patch(`/tasks/${id}`, { status: next });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this task?')) return;
    try {
      await api.del(`/tasks/${id}`);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Tasks"
        sub={user?.role === 'office_boy' ? 'Tasks assigned to you' : `${tasks.length} tasks`}
        actions={
          user?.role !== 'office_boy' && (
            <button className="btn-primary" onClick={() => setModal({ mode: 'add' })}>+ New task</button>
          )
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />

      <div className="flex gap-2 mb-4">
        {['all', 'pending', 'in_progress', 'done'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`chip ${statusFilter === s ? 'bg-teal-700 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'title', label: 'Task', render: (r) => (
              <div>
                <p className="font-medium text-gray-900">{r.title}</p>
                {r.description && <p className="text-xs text-gray-500 truncate max-w-xs">{r.description}</p>}
              </div>
            )},
            { key: 'assignee', label: 'Assignee', render: (r) => r.assignee?.name || r.assigneeName || '—' },
            { key: 'priority', label: 'Priority', render: (r) => <Badge tone={PRIORITY_TONE[r.priority] || 'slate'}>{r.priority || '—'}</Badge> },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{(r.status || '').replace(/_/g, ' ')}</Badge> },
            { key: 'due', label: 'Due', render: (r) => (r.dueDate ? String(r.dueDate).slice(0, 10) : '—') },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) => (
                <div className="flex gap-2">
                  {r.status !== 'done' && (
                    <button className="btn-primary btn-sm" onClick={() => advance(r.id, r.status)}>{NEXT_LABEL[r.status] || 'Advance'}</button>
                  )}
                  {user?.role !== 'office_boy' && (
                    <>
                      <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: 'edit', data: r })}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Delete</button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
          rows={filtered}
          empty={{ title: 'No tasks', hint: user?.role === 'office_boy' ? 'Nothing assigned to you right now.' : 'Create a task to get started.' }}
        />
      </div>

      {modal && (
        <Modal title={modal.mode === 'add' ? 'New task' : 'Edit task'} onClose={() => setModal(null)}>
          <TaskForm initial={modal.data} users={users} onSave={handleSave} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
