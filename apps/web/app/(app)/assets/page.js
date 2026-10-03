'use client';

import { useEffect, useState } from 'react';
import {
  PageHeader, StatCard, DataTable, Modal, Field, Badge, Spinner, ErrorBanner, EmptyState,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';
import { api } from '../../../lib/api';

const CATEGORIES = [
  { v: 'furniture', label: 'Furniture' },
  { v: 'it', label: 'IT Equipment' },
  { v: 'av', label: 'Audio / Video' },
  { v: 'other', label: 'Other' },
];
const STATUSES = ['available', 'in_use', 'maintenance', 'retired'];

const STATUS_BADGE = {
  available: 'success',
  in_use: 'info',
  maintenance: 'warning',
  retired: 'muted',
};

function daysOverdue(dueAt) {
  if (!dueAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dueAt).getTime()) / 86400000));
}

export default function AssetsPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'manager', 'operations_manager', 'office_boy', 'super_admin');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [modal, setModal] = useState(null); // 'add' | 'checkout' | 'return'
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState({ name: '', category: 'other', serialNumber: '', purchaseDate: '', value: '', location: '' });
  const [coForm, setCoForm] = useState({ memberId: '', dueAt: '' });
  const [retForm, setRetForm] = useState({ condition: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (statusFilter) q.set('status', statusFilter);
      if (categoryFilter) q.set('category', categoryFilter);
      const [data, mem] = await Promise.all([
        api.get(`/assets?${q.toString()}`),
        api.get('/members?limit=500'),
      ]);
      setItems(data.items || []);
      setSummary(data.summary || {});
      setMembers(mem.members || mem.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed, statusFilter, categoryFilter]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setCo = (k) => (e) => setCoForm((f) => ({ ...f, [k]: e.target.value }));

  const submitAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/assets', {
        name: form.name,
        category: form.category,
        serialNumber: form.serialNumber || null,
        purchaseDate: form.purchaseDate || null,
        value: form.value ? Number(form.value) : null,
        location: form.location || null,
      });
      setModal(null);
      setForm({ name: '', category: 'other', serialNumber: '', purchaseDate: '', value: '', location: '' });
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const submitCheckout = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post(`/assets/${target.id}/checkout`, {
        memberId: coForm.memberId || null,
        dueAt: coForm.dueAt || null,
      });
      setModal(null);
      setTarget(null);
      setCoForm({ memberId: '', dueAt: '' });
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const submitReturn = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post(`/assets/${target.id}/return`, { condition: retForm.condition || null });
      setModal(null);
      setTarget(null);
      setRetForm({ condition: '' });
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const toggleMaintenance = async (a) => {
    setError('');
    try {
      await api.post(`/assets/${a.id}/maintenance`);
      load();
    } catch (e) { setError(e.message); }
  };

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const openCheckout = (a) => {
    const open = (a.checkouts || []).find((c) => !c.returnedAt);
    return open;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asset Management"
        subtitle="Track furniture, IT & AV assets — check out to members, flag maintenance"
        action={<button className="btn-primary" onClick={() => setModal('add')}>+ Add Asset</button>}
      />
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total" value={items.length} />
        <StatCard label="Available" value={summary.available || 0} accent="green" />
        <StatCard label="In Use" value={summary.in_use || 0} accent="blue" />
        <StatCard label="Maintenance" value={summary.maintenance || 0} accent="amber" />
        <StatCard label="Retired" value={summary.retired || 0} accent="slate" />
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="input max-w-[200px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className="input max-w-[200px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No assets" hint="Add your first asset to start tracking." />
      ) : (
        <DataTable
          columns={[
            { key: 'name', label: 'Asset' },
            { key: 'category', label: 'Category' },
            { key: 'status', label: 'Status' },
            { key: 'holder', label: 'Holder' },
            { key: 'location', label: 'Location' },
            { key: 'actions', label: 'Actions', align: 'right' },
          ]}
          rows={items.map((a) => {
            const oc = openCheckout(a);
            const od = oc && oc.dueAt ? daysOverdue(oc.dueAt) : 0;
            return {
              id: a.id,
              name: <div><div className="font-semibold text-white">{a.name}</div>{a.serialNumber && <div className="text-xs text-slate-400">SN: {a.serialNumber}</div>}</div>,
              category: CATEGORIES.find((c) => c.v === a.category)?.label || a.category,
              status: (
                <span className="flex items-center gap-2">
                  <Badge tone={STATUS_BADGE[a.status] || 'muted'}>{a.status.replace('_', ' ')}</Badge>
                  {od > 0 && <Badge tone="danger">Overdue {od}d</Badge>}
                </span>
              ),
              holder: oc ? (
                <div className="text-sm">
                  <div className="text-white">{oc.member?.name || oc.user?.name || '—'}</div>
                  {oc.dueAt && <div className={od > 0 ? 'text-red-300 text-xs' : 'text-xs text-slate-400'}>Due {new Date(oc.dueAt).toLocaleDateString()}</div>}
                </div>
              ) : <span className="text-slate-500">—</span>,
              location: a.location || '—',
              actions: (
                <div className="flex gap-2 justify-end">
                  {a.status === 'available' && (
                    <button className="btn-secondary btn-sm" onClick={() => { setTarget(a); setModal('checkout'); }}>Check out</button>
                  )}
                  {a.status === 'in_use' && (
                    <button className="btn-secondary btn-sm" onClick={() => { setTarget(a); setModal('return'); }}>Return</button>
                  )}
                  {(a.status === 'available' || a.status === 'maintenance') && (
                    <button className="btn-ghost btn-sm" onClick={() => toggleMaintenance(a)}>
                      {a.status === 'maintenance' ? 'Back to available' : 'Maintenance'}
                    </button>
                  )}
                </div>
              ),
            };
          })}
        />
      )}

      {modal === 'add' && (
        <Modal title="Add Asset" onClose={() => setModal(null)}>
          <form onSubmit={submitAdd} className="space-y-4">
            <Field label="Name"><input className="input" value={form.name} onChange={set('name')} required maxLength={120} placeholder="e.g. Dell Latitude 5440" /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Category">
                <select className="input" value={form.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Serial number"><input className="input" value={form.serialNumber} onChange={set('serialNumber')} maxLength={80} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Purchase date"><input type="date" className="input" value={form.purchaseDate} onChange={set('purchaseDate')} /></Field>
              <Field label="Value (Rs)"><input type="number" min="0" step="0.01" className="input" value={form.value} onChange={set('value')} /></Field>
            </div>
            <Field label="Location"><input className="input" value={form.location} onChange={set('location')} maxLength={120} placeholder="e.g. Floor 2 — Meeting Room A" /></Field>
            <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Add Asset'}</button>
          </form>
        </Modal>
      )}

      {modal === 'checkout' && target && (
        <Modal title={`Check out — ${target.name}`} onClose={() => { setModal(null); setTarget(null); }}>
          <form onSubmit={submitCheckout} className="space-y-4">
            <Field label="Member">
              <select className="input" value={coForm.memberId} onChange={setCo('memberId')}>
                <option value="">Select member…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.email ? ` — ${m.email}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Due date"><input type="date" className="input" value={coForm.dueAt} onChange={setCo('dueAt')} /></Field>
            <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Checking out…' : 'Check Out'}</button>
          </form>
        </Modal>
      )}

      {modal === 'return' && target && (
        <Modal title={`Return — ${target.name}`} onClose={() => { setModal(null); setTarget(null); }}>
          <form onSubmit={submitReturn} className="space-y-4">
            <Field label="Condition note (optional)">
              <textarea className="input" rows={3} value={retForm.condition} onChange={(e) => setRetForm({ condition: e.target.value })} placeholder="e.g. Minor scratch on lid, works fine" maxLength={500} />
            </Field>
            <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Returning…' : 'Mark Returned'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
