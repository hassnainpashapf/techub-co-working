'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, DataTable, Modal, Field, Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const CATEGORIES = [
  { value: 'energy', label: '⚡ Energy' },
  { value: 'water', label: '💧 Water' },
  { value: 'gas', label: '🔥 Gas' },
  { value: 'waste', label: '♻️ Waste' },
  { value: 'awareness', label: '🌱 Awareness' },
];
const STATUSES = [
  { value: 'planned', label: 'Planned', tone: 'slate' },
  { value: 'active', label: 'Active', tone: 'blue' },
  { value: 'completed', label: 'Completed', tone: 'green' },
];
const catLabel = (c) => (CATEGORIES.find((x) => x.value === c) || {}).label || c;
const statusTone = (s) => (STATUSES.find((x) => x.value === s) || {}).tone || 'slate';
const statusLabel = (s) => (STATUSES.find((x) => x.value === s) || {}).label || s;
const NEXT_STATUS = { planned: ['active'], active: ['completed', 'planned'], completed: ['active'] };

const emptyForm = {
  title: '', description: '', category: 'energy',
  targetValue: '', currentValue: '', unit: '',
  startDate: new Date().toISOString().slice(0, 10), endDate: '', status: 'planned',
};

function ProgressBar({ value }) {
  if (value === null || value === undefined) return <span className="text-slate-500 text-xs">—</span>;
  const color = value >= 100 ? 'bg-emerald-500' : value >= 60 ? 'bg-[#8b5cf6]' : value >= 30 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-slate-700/60 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-xs text-slate-300 w-10 text-right">{value}%</span>
    </div>
  );
}

export default function GreenInitiativesPage() {
  const { allowed, loading: roleLoading } = useRequireRoles(['ceo', 'admin', 'super_admin', 'manager']);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState(null); // {mode:'add'|'edit'|'progress', id?}
  const [form, setForm] = useState(emptyForm);
  const [progressVal, setProgressVal] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const q = new URLSearchParams();
      if (catFilter) q.set('category', catFilter);
      if (statusFilter) q.set('status', statusFilter);
      const d = await api.get(`/green-initiatives${q.toString() ? `?${q}` : ''}`);
      setItems(d.initiatives || []);
      setSummary(d.summary || null);
    } catch (e) { setError(e.message || 'Load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (allowed) load(); }, [allowed, catFilter, statusFilter]);

  if (roleLoading) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const openAdd = () => { setForm(emptyForm); setModal({ mode: 'add' }); };
  const openEdit = (it) => {
    setForm({
      title: it.title || '', description: it.description || '', category: it.category || 'energy',
      targetValue: it.targetValue ?? '', currentValue: it.currentValue ?? '',
      unit: it.unit || '',
      startDate: (it.startDate || '').slice(0, 10), endDate: (it.endDate || '').slice(0, 10),
      status: it.status || 'planned',
    });
    setModal({ mode: 'edit', id: it.id });
  };
  const openProgress = (it) => {
    setProgressVal(String(it.currentValue ?? 0));
    setModal({ mode: 'progress', id: it.id, item: it });
  };

  const save = async () => {
    if (!form.title.trim()) { setError('Title lazmi hai'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        targetValue: form.targetValue === '' ? null : Number(form.targetValue),
        currentValue: form.currentValue === '' ? 0 : Number(form.currentValue),
        unit: form.unit.trim() || null,
        startDate: form.startDate,
        endDate: form.endDate || null,
        ...(modal.mode === 'add' ? { status: form.status } : {}),
      };
      if (modal.mode === 'add') await api.post('/green-initiatives', payload);
      else await api.patch(`/green-initiatives/${modal.id}`, payload);
      setModal(null); load();
    } catch (e) { setError(e.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const saveProgress = async () => {
    const v = Number(progressVal);
    if (Number.isNaN(v) || v < 0) { setError('Sahi value dalein'); return; }
    setSaving(true); setError('');
    try {
      await api.patch(`/green-initiatives/${modal.id}/progress`, { currentValue: v });
      setModal(null); load();
    } catch (e) { setError(e.message || 'Progress update failed'); }
    finally { setSaving(false); }
  };

  const changeStatus = async (it, status) => {
    if (!confirm(`Status "${statusLabel(status)}" kar dein?`)) return;
    setError('');
    try {
      await api.patch(`/green-initiatives/${it.id}/status`, { status });
      load();
    } catch (e) { setError(e.message || 'Status update failed'); }
  };

  const remove = async (it) => {
    if (!confirm(`"${it.title}" delete kar dein?`)) return;
    setError('');
    try { await api.del(`/green-initiatives/${it.id}`); load(); }
    catch (e) { setError(e.message || 'Delete failed'); }
  };

  const stats = summary ? [
    { label: 'Total', value: summary.total },
    { label: 'Planned', value: summary.planned },
    { label: 'Active', value: summary.active },
    { label: 'Completed', value: summary.completed },
    { label: 'Avg Progress', value: summary.avgProgress !== null ? `${summary.avgProgress}%` : '—' },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="🌱 Green Initiatives"
        sub="Sustainability goals — energy, water, waste aur awareness"
        actions={<button onClick={openAdd} className="btn-primary">+ Nayi Initiative</button>}
      />
      {error && <ErrorBanner message={error} />}

      {stats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="card-premium p-4">
              <div className="text-xs text-slate-400">{s.label}</div>
              <div className="text-2xl font-bold text-white mt-1">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="input-premium w-auto">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-premium w-auto">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loading ? <Spinner /> : (
        <DataTable
          columns={[
            { key: 'title', label: 'Initiative' },
            { key: 'category', label: 'Category' },
            { key: 'progress', label: 'Progress' },
            { key: 'status', label: 'Status' },
            { key: 'actions', label: 'Actions' },
          ]}
          rows={items.map((it) => ({
            title: (
              <div>
                <div className="font-medium text-white">{it.title}</div>
                <div className="text-xs text-slate-400">
                  {it.currentValue ?? 0}{it.unit ? ` ${it.unit}` : ''}
                  {it.targetValue ? ` / ${it.targetValue}${it.unit ? ` ${it.unit}` : ''}` : ''}
                </div>
              </div>
            ),
            category: <span className="text-slate-300">{catLabel(it.category)}</span>,
            progress: <ProgressBar value={it.progress} />,
            status: <Badge tone={statusTone(it.status)}>{statusLabel(it.status)}</Badge>,
            actions: (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => openProgress(it)} className="btn-ghost text-xs">📈 Progress</button>
                {(NEXT_STATUS[it.status] || []).map((ns) => (
                  <button key={ns} onClick={() => changeStatus(it, ns)} className="btn-ghost text-xs">
                    → {statusLabel(ns)}
                  </button>
                ))}
                <button onClick={() => openEdit(it)} className="btn-ghost text-xs">Edit</button>
                <button onClick={() => remove(it)} className="btn-ghost text-xs text-rose-400">Delete</button>
              </div>
            ),
          }))}
          emptyText="Koi initiative nahi — pehli banayein 🌱"
        />
      )}

      {(modal?.mode === 'add' || modal?.mode === 'edit') && (
        <Modal title={modal.mode === 'add' ? 'Nayi Initiative' : 'Edit Initiative'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Title *">
              <input className="input-premium" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Solar panels lagana" />
            </Field>
            <Field label="Description">
              <textarea className="input-premium" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Category">
                <select className="input-premium" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              {modal.mode === 'add' && (
                <Field label="Status">
                  <select className="input-premium" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Target value">
                <input type="number" min="0" className="input-premium" value={form.targetValue} onChange={(e) => setForm({ ...form, targetValue: e.target.value })} placeholder="e.g. 100" />
              </Field>
              <Field label="Current value">
                <input type="number" min="0" className="input-premium" value={form.currentValue} onChange={(e) => setForm({ ...form, currentValue: e.target.value })} />
              </Field>
              <Field label="Unit">
                <input className="input-premium" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kWh / % / trees" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date">
                <input type="date" className="input-premium" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </Field>
              <Field label="End date">
                <input type="date" className="input-premium" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setModal(null)} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {modal?.mode === 'progress' && (
        <Modal title={`📈 Progress — ${modal.item?.title}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div className="text-sm text-slate-400">
              Target: {modal.item?.targetValue ?? '—'}{modal.item?.unit ? ` ${modal.item.unit}` : ''}
            </div>
            <Field label="Current value *">
              <input type="number" min="0" className="input-premium" value={progressVal} onChange={(e) => setProgressVal(e.target.value)} autoFocus />
            </Field>
            <div className="flex justify-end gap-3">
              <button onClick={() => setModal(null)} className="btn-ghost">Cancel</button>
              <button onClick={saveProgress} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Update'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
