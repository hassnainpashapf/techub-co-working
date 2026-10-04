'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtRs(n) {
  return 'Rs ' + Number(n || 0).toLocaleString();
}

const emptyForm = { name: '', description: '', price: '', mealsPerDay: 1, validDays: 30, isActive: true };

export default function MealPlansPage() {
  const [tab, setTab] = useState('plans'); // plans | subscribers
  const [plans, setPlans] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // null | 'add' | plan
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [planFilter, setPlanFilter] = useState('');
  const [subs, setSubs] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/meal-plans');
      setPlans(data.plans || []);
      setStats(data.stats || null);
    } catch (e) {
      setError(e.message || 'Failed to load meal plans');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function loadSubs(planId) {
    if (!planId) return;
    setSubsLoading(true);
    try {
      const data = await api.get(`/meal-plans/${planId}/subscribers`);
      setSubs(data.subscribers || []);
    } catch (e) {
      setSubs([]);
    } finally {
      setSubsLoading(false);
    }
  }
  useEffect(() => { if (tab === 'subscribers' && plans.length && !planFilter) setPlanFilter(plans[0].id); }, [tab, plans]);
  useEffect(() => { if (tab === 'subscribers' && planFilter) loadSubs(planFilter); }, [tab, planFilter]);

  function openAdd() { setForm(emptyForm); setModal('add'); }
  function openEdit(p) {
    setForm({
      name: p.name, description: p.description || '', price: String(p.price),
      mealsPerDay: p.mealsPerDay, validDays: p.validDays, isActive: p.isActive,
    });
    setModal(p);
  }
  function setF(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.name.trim() || form.price === '' || Number(form.price) < 0) return;
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description || null,
        price: Number(form.price),
        mealsPerDay: Number(form.mealsPerDay),
        validDays: Number(form.validDays),
        isActive: !!form.isActive,
      };
      if (modal === 'add') await api.post('/meal-plans', body);
      else await api.patch(`/meal-plans/${modal.id}`, body);
      setModal(null);
      load();
    } catch (e) {
      alert(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p) {
    if (!confirm(`Delete plan "${p.name}"?`)) return;
    try {
      await api.delete(`/meal-plans/${p.id}`);
      load();
    } catch (e) {
      alert(e.message || 'Delete failed');
    }
  }

  const columns = [
    { key: 'name', label: 'Plan', render: (p) => (<div><div className="font-medium">{p.name}</div><div className="text-xs opacity-60">{p.description || ''}</div></div>) },
    { key: 'price', label: 'Price', render: (p) => fmtRs(p.price) },
    { key: 'meals', label: 'Meals', render: (p) => `${p.mealsPerDay}/day × ${p.validDays}d = ${p.mealsPerDay * p.validDays}` },
    { key: 'subs', label: 'Subscribers', render: (p) => p._count?.subscriptions ?? '—' },
    { key: 'status', label: 'Status', render: (p) => (p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
    {
      key: 'actions', label: 'Actions', render: (p) => (
        <div className="flex gap-2">
          <button className="text-xs underline" onClick={() => openEdit(p)}>Edit</button>
          <button className="text-xs underline text-red-400" onClick={() => remove(p)}>Delete</button>
        </div>
      ),
    },
  ];

  const subColumns = [
    { key: 'member', label: 'Member', render: (s) => s.member?.name || '—' },
    { key: 'email', label: 'Email', render: (s) => s.member?.email || '—' },
    { key: 'used', label: 'Meals', render: (s) => `${s.mealsUsed}/${s.mealsTotal}` },
    { key: 'progress', label: 'Progress', render: (s) => (
      <div className="w-28 h-2 rounded bg-white/10 overflow-hidden"><div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, (s.mealsUsed / Math.max(1, s.mealsTotal)) * 100)}%` }} /></div>
    ) },
    { key: 'end', label: 'Valid till', render: (s) => fmtDate(s.endDate) },
    { key: 'status', label: 'Status', render: (s) => (s.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="slate">{s.status}</Badge>) },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="🍱 Meal Plans" subtitle="Monthly lunch / meal subscriptions for members" action={
        <button onClick={openAdd} className="px-4 py-2 rounded-lg bg-[#7c3aed] hover:bg-[#8b5cf6] text-white text-sm font-medium">+ New Plan</button>
      } />

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2">
        {['plans', 'subscribers'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-sm capitalize ${tab === t ? 'bg-[#7c3aed] text-white' : 'bg-white/5 text-slate-300'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'plans' && (
        <>
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total plans" value={stats.total} />
              <StatCard label="Active plans" value={stats.active} />
              <StatCard label="Total subscribers" value={stats.subscribers} />
              <StatCard label="Active subscriptions" value={stats.activeSubs} />
            </div>
          )}
          {loading ? <Spinner /> : plans.length === 0 ? <EmptyState title="No meal plans yet" /> : (
            <DataTable columns={columns} rows={plans} rowKey={(p) => p.id} />
          )}
        </>
      )}

      {tab === 'subscribers' && (
        <div className="space-y-4">
          <div className="flex gap-2 items-center">
            <label className="text-sm opacity-70">Plan:</label>
            <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {subsLoading ? <Spinner /> : subs.length === 0 ? <EmptyState title="No subscribers" /> : (
            <DataTable columns={subColumns} rows={subs} rowKey={(s) => s.id} />
          )}
        </div>
      )}

      {modal && (
        <Modal title={modal === 'add' ? 'New Meal Plan' : `Edit: ${modal.name}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Plan name" value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="Monthly Lunch" />
            <Field label="Description" value={form.description} onChange={(e) => setF('description', e.target.value)} placeholder="Weekday lunch, 1 meal/day" />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Price (Rs)" type="number" value={form.price} onChange={(e) => setF('price', e.target.value)} />
              <Field label="Meals/day" type="number" value={form.mealsPerDay} onChange={(e) => setF('mealsPerDay', e.target.value)} />
              <Field label="Valid days" type="number" value={form.validDays} onChange={(e) => setF('validDays', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setF('isActive', e.target.checked)} /> Active (visible to members)
            </label>
            <div className="text-xs opacity-60">Total meals per subscription: {Number(form.mealsPerDay || 0) * Number(form.validDays || 0)}</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg bg-white/5 text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-[#7c3aed] hover:bg-[#8b5cf6] text-white text-sm">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
