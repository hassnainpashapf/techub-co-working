'use client';

// Phase 42 Track 7: Employee Onboarding Checklists.
// Templates + active onboardings with progress bars.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const emptyTemplate = { name: '', isDefault: false, tasks: [{ title: '', dept: 'admin', dayOffset: 0 }] };

function ProgressBar({ pct }) {
  return (
    <div className="w-full h-2 rounded-full bg-slate-700/60 overflow-hidden">
      <div className="h-full rounded-full bg-gradient-to-r from-[#0f766e] to-teal-600 transition-all" style={{ width: pct + '%' }} />
    </div>
  );
}

export default function OnboardingPage() {
  const [templates, setTemplates] = useState([]);
  const [onboardings, setOnboardings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // 'template' | onboarding-detail
  const [form, setForm] = useState(emptyTemplate);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [t, o] = await Promise.all([
        api.get('/employee-onboarding/templates'),
        api.get('/employee-onboarding'),
      ]);
      setTemplates(t.templates || []);
      setOnboardings(o.onboardings || []);
    } catch (e) {
      setError(e.message || 'Data load nahi ho saka');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const inProgress = onboardings.filter((o) => o.status === 'in_progress');
  const completed = onboardings.filter((o) => o.status === 'completed');

  function openAdd() { setForm(emptyTemplate); setModal('template'); }

  function setTask(i, patch) {
    setForm((f) => ({ ...f, tasks: f.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  }
  function addTask() {
    setForm((f) => ({ ...f, tasks: [...f.tasks, { title: '', dept: 'admin', dayOffset: 0 }] }));
  }
  function removeTask(i) {
    setForm((f) => ({ ...f, tasks: f.tasks.filter((_, j) => j !== i) }));
  }

  async function saveTemplate(e) {
    e.preventDefault();
    const tasks = form.tasks.filter((t) => t.title.trim()).map((t) => ({
      title: t.title.trim(), dept: t.dept || 'admin', dayOffset: Number(t.dayOffset) || 0,
    }));
    if (!form.name.trim() || !tasks.length) { setError('Naam aur kam az kam ek task lazmi hai'); return; }
    setSaving(true);
    try {
      await api.post('/employee-onboarding/templates', { name: form.name.trim(), isDefault: !!form.isDefault, tasks });
      setModal(null);
      load();
    } catch (e) {
      setError(e.message || 'Template save nahi ho saka');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id) {
    if (!confirm('Template delete karna hai?')) return;
    try { await api.del('/employee-onboarding/templates/' + id); load(); }
    catch (e) { setError(e.message || 'Delete nahi ho saka'); }
  }

  async function checkItem(obId, index) {
    try {
      const data = await api.post(`/employee-onboarding/${obId}/check`, { index });
      setDetail(data.onboarding);
      load();
    } catch (e) { setError(e.message || 'Check nahi ho saka'); }
  }

  const obCols = [
    { key: 'employee', label: 'Employee', render: (o) => <div><div className="font-medium">{o.employee?.name || '—'}</div><div className="text-xs text-gray-500">{o.employee?.designation || ''}</div></div> },
    {
      key: 'progress', label: 'Progress', render: (o) => (
        <div className="min-w-[140px]">
          <div className="text-xs text-gray-600 mb-1">{o.progress.done}/{o.progress.total} tasks — {o.progress.pct}%</div>
          <ProgressBar pct={o.progress.pct} />
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (o) => o.status === 'completed' ? <Badge tone="green">Completed</Badge> : <Badge tone="amber">In progress</Badge> },
    { key: 'startedAt', label: 'Started', render: (o) => new Date(o.startedAt).toLocaleDateString() },
    { key: 'action', label: '', render: (o) => <button className="text-teal-700 hover:text-teal-700 text-sm" onClick={() => setDetail(o)}>View</button> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee Onboarding"
        sub="Naye staff ke liye checklist-based onboarding"
        actions={<button onClick={openAdd} className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#0f766e] to-teal-700 hover:from-[#0f766e] hover:to-teal-600 text-gray-900 text-sm font-medium shadow-lg shadow-blue-900/40">+ New Template</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Templates" value={templates.length} accent="blue" icon="📋" />
        <StatCard label="In Progress" value={inProgress.length} accent="amber" icon="⏳" />
        <StatCard label="Completed" value={completed.length} accent="green" icon="✅" />
        <StatCard label="Total Tasks" value={templates.reduce((a, t) => a + (Array.isArray(t.tasks) ? t.tasks.length : 0), 0)} accent="violet" icon="📝" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Onboarding Templates</h2>
        {loading ? <Spinner /> : templates.length === 0 ? <EmptyState title="Koi template nahi" hint="Pehla template banao taake naye employees ka onboarding auto-start ho" /> : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-gray-200/60 bg-white p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-medium text-gray-900">{t.name}</div>
                  {t.isDefault && <Badge tone="blue">Default</Badge>}
                </div>
                <div className="text-sm text-gray-500 mb-3">{Array.isArray(t.tasks) ? t.tasks.length : 0} tasks</div>
                <button onClick={() => deleteTemplate(t.id)} className="text-xs text-red-400 hover:text-red-700">Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Onboardings</h2>
        {loading ? <Spinner /> : onboardings.length === 0 ? <EmptyState title="Koi onboarding nahi" hint="Employees page se naya employee banne par default template auto-start hoga" /> : (
          <DataTable columns={obCols} rows={onboardings} empty="Koi onboarding nahi" />
        )}
      </div>

      {modal === 'template' && (
        <Modal title="New Onboarding Template" onClose={() => setModal(null)}>
          <form onSubmit={saveTemplate} className="space-y-4">
            <Field label="Template Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" placeholder="e.g. Receptionist Onboarding" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="accent-[#0f766e]" />
              Default template (naye employee par auto-start)
            </label>
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-600">Tasks</div>
              {form.tasks.map((t, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} placeholder="Task title" className="flex-1 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" />
                  <input value={t.dept} onChange={(e) => setTask(i, { dept: e.target.value })} placeholder="Dept" className="w-24 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" />
                  <input type="number" min="0" value={t.dayOffset} onChange={(e) => setTask(i, { dayOffset: e.target.value })} placeholder="Day" title="Day offset" className="w-20 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm" />
                  <button type="button" onClick={() => removeTask(i)} className="text-red-400 hover:text-red-700 text-lg">×</button>
                </div>
              ))}
              <button type="button" onClick={addTask} className="text-sm text-teal-700 hover:text-teal-700">+ Add task</button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#0f766e] to-teal-700 text-gray-900 text-sm font-medium">{saving ? 'Saving...' : 'Save Template'}</button>
            </div>
          </form>
        </Modal>
      )}

      {detail && (
        <Modal title={`Onboarding — ${detail.employee?.name || ''}`} onClose={() => setDetail(null)}>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {(Array.isArray(detail.items) ? detail.items : []).map((it, i) => (
              <div key={i} className={`flex items-center gap-3 rounded-lg border p-3 ${it.done ? 'border-green-800/60 bg-green-950/20' : 'border-gray-200/60 bg-white'}`}>
                <button
                  onClick={() => checkItem(detail.id, i)}
                  disabled={it.done}
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${it.done ? 'border-green-500 bg-green-500 text-white' : 'border-slate-500 hover:border-[#0f766e]'}`}
                >
                  {it.done && '✓'}
                </button>
                <div className="flex-1">
                  <div className={`text-sm ${it.done ? 'line-through text-slate-500' : 'text-gray-900'}`}>{it.title}</div>
                  <div className="text-xs text-gray-500">{it.dept}{it.dayOffset ? ` • Day ${it.dayOffset}` : ''}{it.doneAt ? ` • ${new Date(it.doneAt).toLocaleDateString()}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
