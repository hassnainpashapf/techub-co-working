'use client';

// Phase 41 Track 1: Vendor Management — vendor directory + add/edit modal + category pills.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';
import VendorPerformanceTab from '../../../../components/VendorPerformanceTab';

const CATEGORIES = [
  { value: 'all', label: 'Sab' },
  { value: 'maintenance', label: '🔧 Maintenance' },
  { value: 'food', label: '🍔 Food & Drink' },
  { value: 'it', label: '💻 IT & Tech' },
  { value: 'office', label: '🗄️ Office Supplies' },
  { value: 'other', label: '📦 Other' },
];
const catLabel = (c) => (CATEGORIES.find((x) => x.value === c) || {}).label || c;

const TERMS = [
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'cod', label: 'Cash on Delivery' },
];
const termLabel = (t) => (TERMS.find((x) => x.value === t) || {}).label || t;

const emptyForm = { name: '', company: '', email: '', phone: '', address: '', category: 'other', paymentTerms: 'net_30', taxId: '', isActive: true, notes: '' };

export default function VendorsPage() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [modal, setModal] = useState(null); // null | 'add' | vendor
  const [vtab, setVtab] = useState('details'); // details | perf (Phase 41)
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (cat !== 'all') q.set('category', cat);
      const data = await api.get('/vendors?' + q.toString());
      setVendors(data.vendors || []);
    } catch (e) {
      setError(e.message || 'Vendors load nahi ho sake');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); }, [search, cat]);

  function openAdd() { setForm(emptyForm); setVtab('details'); setModal('add'); }
  function openEdit(v) {
    setVtab('details');
    setForm({
      name: v.name || '', company: v.company || '', email: v.email || '', phone: v.phone || '',
      address: v.address || '', category: v.category || 'other', paymentTerms: v.paymentTerms || 'net_30',
      taxId: v.taxId || '', isActive: v.isActive, notes: v.notes || '',
    });
    setModal(v);
  }

  async function save() {
    setSaving(true);
    try {
      if (modal === 'add') await api.post('/vendors', form);
      else await api.patch('/vendors/' + modal.id, form);
      setModal(null);
      load();
    } catch (e) {
      setError(e.message || 'Save nahi ho saka');
    } finally {
      setSaving(false);
    }
  }

  async function remove(v) {
    if (!confirm(v.name + ' ko deactivate karna hai?')) return;
    try {
      await api.del('/vendors/' + v.id);
      load();
    } catch (e) {
      setError(e.message || 'Deactivate nahi ho saka');
    }
  }

  const active = vendors.filter((v) => v.isActive);
  const withRating = vendors.filter((v) => v.rating != null);

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle="Supplier directory — maintenance, food, IT, office aur baqi vendors"
        action={<button className="btn-primary" onClick={openAdd}>+ Naya Vendor</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="grid-4 mb-4">
        <StatCard title="Total Vendors" value={vendors.length} />
        <StatCard title="Active" value={active.length} />
        <StatCard title="Categories" value={new Set(vendors.map((v) => v.category)).size} />
        <StatCard title="Rated" value={withRating.length} />
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input max-w-xs" placeholder="🔍 Naam, company, email, phone..."
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCat(c.value)}
              className={cat === c.value ? 'pill pill-active' : 'pill'}
            >{c.label}</button>
          ))}
        </div>
      </div>

      {loading ? <Spinner /> : vendors.length === 0 ? (
        <EmptyState title="Koi vendor nahi" message="Pehla vendor add karein taake purchase orders aur bills track hon." />
      ) : (
        <DataTable
          columns={[
            { key: 'name', label: 'Vendor' },
            { key: 'category', label: 'Category' },
            { key: 'contact', label: 'Contact' },
            { key: 'paymentTerms', label: 'Terms' },
            { key: 'rating', label: 'Rating' },
            { key: 'status', label: 'Status' },
            { key: 'actions', label: '' },
          ]}
          rows={vendors.map((v) => ({
            key: v.id,
            name: <div><div className="font-semibold">{v.name}</div><div className="text-dim text-sm">{v.company || '—'}</div></div>,
            category: catLabel(v.category),
            contact: <div><div className="text-sm">{v.email || '—'}</div><div className="text-dim text-sm">{v.phone || ''}</div></div>,
            paymentTerms: termLabel(v.paymentTerms),
            rating: v.rating != null ? `⭐ ${Number(v.rating).toFixed(1)}` : <span className="text-dim">—</span>,
            status: v.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>,
            actions: (
              <div className="flex gap-2">
                <button className="btn-sm" onClick={() => openEdit(v)}>Edit</button>
                {v.isActive && <button className="btn-sm btn-danger" onClick={() => remove(v)}>Deactivate</button>}
              </div>
            ),
          }))}
        />
      )}

      {modal && (
        <Modal title={modal === 'add' ? 'Naya Vendor' : 'Vendor Edit'} onClose={() => setModal(null)}>
          {modal !== 'add' && (
            <div className="flex gap-2 mb-4">
              <button className={vtab === 'details' ? 'pill pill-active' : 'pill'} onClick={() => setVtab('details')}>Details</button>
              <button className={vtab === 'perf' ? 'pill pill-active' : 'pill'} onClick={() => setVtab('perf')}>Performance & Ratings</button>
            </div>
          )}
          {vtab === 'perf' && modal !== 'add' ? (
            <VendorPerformanceTab vendorId={modal.id} />
          ) : (
          <>
          <div className="grid-2 gap-3">
            <Field label="Naam *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Company"><input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Category">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.filter((c) => c.value !== 'all').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Payment Terms">
              <select className="input" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
                {TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Tax ID"><input className="input" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} /></Field>
            <Field label="Active">
              <select className="input" value={form.isActive ? '1' : '0'} onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </Field>
          </div>
          <Field label="Address"><textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary" disabled={saving || !form.name} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
          </>
          )}
        </Modal>
      )}
    </div>
  );
}
