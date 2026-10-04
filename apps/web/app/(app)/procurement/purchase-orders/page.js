'use client';

// Phase 41 Track 2: Purchase Orders — list + builder (line items, tax)
// + submit/approve/reject workflow + branded PDF.
import { useEffect, useMemo, useState } from 'react';
import { api, apiDownload } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard, DataTable } from '../../../../components/ui';

const STATUSES = [
  { key: 'draft', label: 'Draft', tone: 'slate' },
  { key: 'pending_approval', label: 'Pending Approval', tone: 'amber' },
  { key: 'approved', label: 'Approved', tone: 'blue' },
  { key: 'rejected', label: 'Rejected', tone: 'red' },
  { key: 'ordered', label: 'Ordered', tone: 'violet' },
  { key: 'received', label: 'Received', tone: 'green' },
  { key: 'closed', label: 'Closed', tone: 'slate' },
];
const toneFor = (s) => (STATUSES.find((x) => x.key === s) || {}).tone || 'slate';

const fmtMoney = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const totalOf = (items, tax) => {
  const sub = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  return { sub, total: sub + (Number(tax) || 0) };
};

function BuilderForm({ vendors, initial, onSave, saving }) {
  const [f, setF] = useState({
    vendorId: initial?.vendorId || '',
    tax: initial?.tax ?? 0,
    notes: initial?.notes || '',
  });
  const [items, setItems] = useState(initial?.items?.length ? initial.items : [{ desc: '', qty: 1, price: 0 }]);

  const setItem = (i, patch) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems([...items, { desc: '', qty: 1, price: 0 }]);
  const removeItem = (i) => setItems(items.filter((_, j) => j !== i));
  const { sub, total } = totalOf(items, f.tax);

  const valid = f.vendorId && items.length > 0 && items.every((it) => it.desc.trim() && Number(it.qty) > 0);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({
        vendorId: f.vendorId,
        tax: Number(f.tax) || 0,
        notes: f.notes,
        items: items.map((it) => ({ desc: it.desc.trim(), qty: Number(it.qty), price: Number(it.price) })),
      });
    }}>
      <Field label="Vendor *">
        <select className="input" value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} required>
          <option value="">Select vendor…</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.company ? ` — ${v.company}` : ''}</option>)}
        </select>
      </Field>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Line Items *</span>
        <button type="button" className="btn-ghost text-xs" onClick={addItem}>+ Add item</button>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_110px_30px] gap-2 items-center">
            <input className="input" value={it.desc} onChange={(e) => setItem(i, { desc: e.target.value })} placeholder="Description (e.g. Printer toner)" required />
            <input type="number" min="0.01" step="any" className="input" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} placeholder="Qty" />
            <input type="number" min="0" step="any" className="input" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} placeholder="Price" />
            <button type="button" className="btn-ghost text-red-400" onClick={() => removeItem(i)} disabled={items.length === 1} title="Remove">✕</button>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 items-end">
        <Field label="Tax (Rs)"><input type="number" min="0" step="any" className="input" value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} /></Field>
        <div className="text-right">
          <div className="text-sm text-gray-500">Subtotal: {fmtMoney(sub)}</div>
          <div className="text-lg font-bold">Total: {fmtMoney(total)}</div>
        </div>
      </div>

      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Optional notes…" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving || !valid}>{saving ? 'Saving…' : (initial ? 'Update PO' : 'Create PO')}</button>
    </form>
  );
}

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, value: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rejectId, setRejectId] = useState(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = async () => {
    try {
      setLoading(true); setError('');
      const [poRes, vRes] = await Promise.all([
        api('/api/purchase-orders' + (status ? `?status=${status}` : '')),
        api('/api/vendors').catch(() => ({ data: [] })),
      ]);
      setPos(poRes.data || []);
      setVendors(vRes.data || []);
      setStats({ total: poRes.total || 0, pending: poRes.pending || 0, value: (poRes.data || []).reduce((s, p) => s + Number(p.total || 0), 0) });
    } catch (e) { setError(e.message || 'Load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    if (!search.trim()) return pos;
    const q = search.toLowerCase();
    return pos.filter((p) => p.number.toLowerCase().includes(q) || (p.vendor?.name || '').toLowerCase().includes(q));
  }, [pos, search]);

  const act = async (id, action, body) => {
    try { setError(''); await api(`/api/purchase-orders/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); await load(); }
    catch (e) { setError(e.message || 'Action failed'); }
  };
  const downloadPdf = async (id, number) => {
    try { await apiDownload(`/api/purchase-orders/${id}/pdf`, `${number}.pdf`); }
    catch (e) { setError(e.message || 'PDF download failed'); }
  };
  const save = async (payload) => {
    try {
      setSaving(true); setError('');
      if (editing) await api(`/api/purchase-orders/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/purchase-orders', { method: 'POST', body: JSON.stringify(payload) });
      setShowAdd(false); setEditing(null); await load();
    } catch (e) { setError(e.message || 'Save failed'); }
    finally { setSaving(false); }
  };
  const del = async (id) => {
    if (!confirm('Delete this draft PO?')) return;
    try { await api(`/api/purchase-orders/${id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e.message || 'Delete failed'); }
  };

  const canTransition = (po, action) => {
    const map = { submit: 'draft', approve: 'pending_approval', reject: 'pending_approval', 'mark-ordered': 'approved', 'mark-received': 'ordered', close: 'received' };
    return po.status === map[action];
  };

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Vendor kharidari — draft se approval tak"
        actions={<button className="btn-primary" onClick={() => setShowAdd(true)}>+ New PO</button>}
      />
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-3 gap-3 mb-3">
        <StatCard label="Total POs" value={stats.total} />
        <StatCard label="Pending Approval" value={stats.pending} />
        <StatCard label="PO Value" value={fmtMoney(stats.value)} />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input className="input max-w-xs" placeholder="Search number/vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[220px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? <EmptyState title="No purchase orders" /> : (
        <DataTable
          columns={[
            { key: 'number', label: 'PO #' },
            { key: 'vendor', label: 'Vendor', render: (p) => p.vendor?.name || '—' },
            { key: 'items', label: 'Items', render: (p) => (p.items || []).length },
            { key: 'total', label: 'Total', render: (p) => fmtMoney(p.total) },
            { key: 'status', label: 'Status', render: (p) => <Badge tone={toneFor(p.status)}>{p.status.replace('_', ' ')}</Badge> },
            { key: 'createdAt', label: 'Created', render: (p) => fmtDate(p.createdAt) },
            {
              key: 'actions', label: 'Actions', render: (p) => (
                <div className="flex flex-wrap gap-1">
                  {canTransition(p, 'submit') && <button className="btn-ghost text-xs" onClick={() => act(p.id, 'submit')}>Submit</button>}
                  {canTransition(p, 'approve') && <button className="btn-ghost text-xs text-green-400" onClick={() => act(p.id, 'approve')}>Approve</button>}
                  {canTransition(p, 'reject') && <button className="btn-ghost text-xs text-red-400" onClick={() => setRejectId(p.id)}>Reject</button>}
                  {canTransition(p, 'mark-ordered') && <button className="btn-ghost text-xs" onClick={() => act(p.id, 'mark-ordered')}>Ordered</button>}
                  {canTransition(p, 'mark-received') && <button className="btn-ghost text-xs" onClick={() => act(p.id, 'mark-received')}>Received</button>}
                  {canTransition(p, 'close') && <button className="btn-ghost text-xs" onClick={() => act(p.id, 'close')}>Close</button>}
                  <button className="btn-ghost text-xs" onClick={() => downloadPdf(p.id, p.number)}>PDF</button>
                  {p.status === 'draft' && <button className="btn-ghost text-xs" onClick={() => setEditing(p)}>Edit</button>}
                  {p.status === 'draft' && <button className="btn-ghost text-xs text-red-400" onClick={() => del(p.id)}>Delete</button>}
                </div>
              ),
            },
          ]}
          rows={filtered}
        />
      )}

      {showAdd && (
        <Modal title="New Purchase Order" onClose={() => setShowAdd(false)}>
          <BuilderForm vendors={vendors} onSave={save} saving={saving} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.number}`} onClose={() => setEditing(null)}>
          <BuilderForm vendors={vendors} initial={editing} onSave={save} saving={saving} />
        </Modal>
      )}
      {rejectId && (
        <Modal title="Reject PO" onClose={() => { setRejectId(null); setRejectNote(''); }}>
          <form onSubmit={(e) => { e.preventDefault(); if (rejectNote.trim()) { act(rejectId, 'reject', { note: rejectNote.trim() }); setRejectId(null); setRejectNote(''); } }}>
            <Field label="Rejection reason *">
              <textarea className="input" rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} required placeholder="e.g. Budget se zyada hai…" />
            </Field>
            <button type="submit" className="btn-primary w-full" disabled={!rejectNote.trim()}>Reject PO</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
