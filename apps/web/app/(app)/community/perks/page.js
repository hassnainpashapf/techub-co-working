'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const CATEGORIES = [
  { value: 'food', label: '🍔 Food & Drink' },
  { value: 'fitness', label: '💪 Fitness' },
  { value: 'tech', label: '💻 Tech' },
  { value: 'travel', label: '✈️ Travel' },
  { value: 'other', label: '🎁 Other' },
];
const catLabel = (c) => (CATEGORIES.find((x) => x.value === c) || {}).label || c;

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const emptyForm = { partnerName: '', title: '', description: '', discountText: '', category: 'other', code: '', expiryDate: '', isActive: true };

export default function PerksManagePage() {
  const [perks, setPerks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // null | 'add' | perk
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/perks?all=1');
      setPerks(data.perks || []);
    } catch (e) {
      setError(e.message || 'Failed to load perks');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openAdd() { setForm(emptyForm); setModal('add'); }
  function openEdit(p) {
    setForm({
      partnerName: p.partnerName, title: p.title, description: p.description || '',
      discountText: p.discountText, category: p.category, code: p.code || '',
      expiryDate: p.expiryDate ? new Date(p.expiryDate).toISOString().slice(0, 10) : '',
      isActive: p.isActive,
    });
    setModal(p);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, expiryDate: form.expiryDate || null, code: form.code || null };
      if (modal === 'add') await api.post('/perks', body);
      else await api.put(`/perks/${modal.id}`, body);
      setModal(null);
      await load();
    } catch (err) {
      alert(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p) {
    if (!confirm(`Delete "${p.title}"? Claims will be removed too.`)) return;
    try {
      await api.delete(`/perks/${p.id}`);
      await load();
    } catch (e) {
      alert(e.message || 'Delete failed');
    }
  }

  const visible = perks.filter((p) => {
    if (filter === 'active') return p.isActive;
    if (filter === 'inactive') return !p.isActive;
    return true;
  });
  const totalClaims = perks.reduce((s, p) => s + (p.claimsCount || 0), 0);
  const activeCount = perks.filter((p) => p.isActive).length;

  if (loading) return <Spinner />;
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Perks & Benefits"
        sub="Partner discounts for your members"
        actions={<button onClick={openAdd} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">+ New perk</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total perks" value={perks.length} accent="blue" />
        <StatCard label="Active" value={activeCount} accent="green" />
        <StatCard label="Total claims" value={totalClaims} accent="violet" />
      </div>

      <div className="flex gap-2 text-sm">
        {['all', 'active', 'inactive'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 font-medium ${filter === f ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No perks yet" hint="Add your first partner perk — food, fitness, tech deals and more." />
      ) : (
        <DataTable
          columns={['Partner', 'Perk', 'Discount', 'Category', 'Code', 'Expiry', 'Claims', 'Status', 'Actions']}
          rows={visible.map((p) => ([
            <span key="pn" className="font-medium text-white">{p.partnerName}</span>,
            <span key="t" className="text-slate-200">{p.title}</span>,
            <Badge key="d" tone="blue">{p.discountText}</Badge>,
            <span key="c" className="text-slate-300">{catLabel(p.category)}</span>,
            <code key="cd" className="text-xs text-amber-300">{p.code || '—'}</code>,
            <span key="e" className="text-slate-400">{fmtDate(p.expiryDate)}</span>,
            <span key="cl" className="text-slate-200">{p.claimsCount || 0}</span>,
            p.isActive ? <Badge key="s" tone="green">Active</Badge> : <Badge key="s" tone="slate">Inactive</Badge>,
            <div key="a" className="flex gap-2">
              <button onClick={() => openEdit(p)} className="text-sm text-blue-400 hover:text-blue-300">Edit</button>
              <button onClick={() => remove(p)} className="text-sm text-red-400 hover:text-red-300">Delete</button>
            </div>,
          ]))}
        />
      )}

      {modal && (
        <Modal title={modal === 'add' ? 'New perk' : `Edit — ${modal.title}`} onClose={() => setModal(null)}>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Partner name *"><input value={form.partnerName} onChange={(e) => setForm({ ...form, partnerName: e.target.value })} required maxLength={120} className="w-full rounded-lg bg-white/5 px-3 py-2 text-white" /></Field>
              <Field label="Category"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg bg-white/5 px-3 py-2 text-white">{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
            </div>
            <Field label="Title *"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={160} placeholder="Free protein shake every week" className="w-full rounded-lg bg-white/5 px-3 py-2 text-white" /></Field>
            <Field label="Description"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full rounded-lg bg-white/5 px-3 py-2 text-white" /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Discount text *"><input value={form.discountText} onChange={(e) => setForm({ ...form, discountText: e.target.value })} required maxLength={80} placeholder="20% off" className="w-full rounded-lg bg-white/5 px-3 py-2 text-white" /></Field>
              <Field label="Redeem code"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} maxLength={120} placeholder="TECHUB20" className="w-full rounded-lg bg-white/5 px-3 py-2 text-white" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Expiry date"><input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} className="w-full rounded-lg bg-white/5 px-3 py-2 text-white" /></Field>
              <Field label="Status"><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label></Field>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/10">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">{saving ? 'Saving…' : 'Save perk'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
