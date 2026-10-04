'use client';

// Phase 41 Track 9: Vendor Contract Expiry Tracking — contract list + expiry timeline + renew.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Modal, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

const emptyForm = {
  vendorId: '', title: '', startDate: '', endDate: '',
  value: '', autoRenew: false, documentUrl: '', reminderDays: 30,
};

const statusBadge = (c) => {
  if (c.status === 'expired') return <Badge tone="red">Expired</Badge>;
  if (c.daysLeft <= 30) return <Badge tone="amber">{c.daysLeft} din baqi</Badge>;
  return <Badge tone="green">Active</Badge>;
};

export default function VendorContractsPage() {
  const [contracts, setContracts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [stats, setStats] = useState({ counts: {}, expiring30d: 0, activeValue: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState(null); // null | 'add' | contract(obj) | {renew: contract}
  const [form, setForm] = useState(emptyForm);
  const [renewDate, setRenewDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (status !== 'all') q.set('status', status);
      const [c, v, s] = await Promise.all([
        api.get('/vendor-contracts?' + q.toString()),
        api.get('/vendors?').catch(() => ({ vendors: [] })),
        api.get('/vendor-contracts/stats').catch(() => ({ counts: {}, expiring30d: 0, activeValue: 0 })),
      ]);
      setContracts(c.contracts || []);
      setVendors(v.vendors || []);
      setStats(s);
    } catch (e) {
      setError(e.message || 'Contracts load nahi ho sake');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { load(); }, [status]);

  function openAdd() { setForm(emptyForm); setModal('add'); }
  function openEdit(c) {
    setForm({
      vendorId: c.vendorId || '', title: c.title || '',
      startDate: c.startDate ? c.startDate.slice(0, 10) : '',
      endDate: c.endDate ? c.endDate.slice(0, 10) : '',
      value: c.value != null ? c.value : '',
      autoRenew: !!c.autoRenew, documentUrl: c.documentUrl || '',
      reminderDays: c.reminderDays ?? 30,
    });
    setModal(c);
  }
  function openRenew(c) { setRenewDate(''); setModal({ renew: c }); }

  function toPayload(f) {
    return {
      vendorId: f.vendorId,
      title: f.title,
      startDate: f.startDate || null,
      endDate: f.endDate,
      value: f.value === '' ? null : Number(f.value),
      autoRenew: !!f.autoRenew,
      documentUrl: f.documentUrl || null,
      reminderDays: Number(f.reminderDays) || 30,
    };
  }

  async function save() {
    setSaving(true);
    try {
      if (modal === 'add') await api.post('/vendor-contracts', toPayload(form));
      else await api.patch('/vendor-contracts/' + modal.id, toPayload(form));
      setModal(null);
      load();
    } catch (e) {
      setError(e.message || 'Save nahi ho saka');
    } finally {
      setSaving(false);
    }
  }

  async function doRenew() {
    if (!renewDate) { setError('Nayi end date select karein'); return; }
    setSaving(true);
    try {
      await api.post('/vendor-contracts/' + modal.renew.id + '/renew', { endDate: renewDate });
      setModal(null);
      load();
    } catch (e) {
      setError(e.message || 'Renew nahi ho saka');
    } finally {
      setSaving(false);
    }
  }

  async function remove(c) {
    if (!confirm(`"${c.title}" contract delete karna hai?`)) return;
    try {
      await api.del('/vendor-contracts/' + c.id);
      load();
    } catch (e) {
      setError(e.message || 'Delete nahi ho saka');
    }
  }

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Expiry timeline: active contracts, endDate ke hisab se sorted (nearest first)
  const timeline = contracts.filter((c) => c.status === 'active').slice(0, 8);
  const maxSpan = Math.max(60, ...timeline.map((c) => Math.max(c.daysLeft, 0)));

  return (
    <div>
      <PageHeader
        title="Vendor Contracts"
        subtitle="Supplier contracts, expiry tracking aur renewal"
        action={<button className="btn-primary" onClick={openAdd}>+ Naya Contract</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="grid-4 mb-4">
        <StatCard title="Active" value={stats.counts.active || 0} />
        <StatCard title="Expired" value={stats.counts.expired || 0} />
        <StatCard title="30 din me expire" value={stats.expiring30d || 0} />
        <StatCard title="Active value (Rs)" value={(stats.activeValue || 0).toLocaleString()} />
      </div>

      {timeline.length > 0 && (
        <div className="card mb-4">
          <div className="font-semibold mb-3">⏳ Expiry Timeline</div>
          <div className="flex flex-col gap-2">
            {timeline.map((c) => {
              const pct = Math.min(100, Math.max(4, (Math.max(c.daysLeft, 0) / maxSpan) * 100));
              const barColor = c.daysLeft <= 30 ? 'bg-amber-500' : c.daysLeft <= 90 ? 'bg-[#8b5cf6]' : 'bg-green-600';
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <div className="w-56 truncate text-sm" title={c.title}>{c.vendor?.name} — {c.title}</div>
                  <div className="flex-1 h-3 rounded-full bg-slate-700/50 overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: pct + '%' }} />
                  </div>
                  <div className="w-32 text-sm text-dim text-right">{c.daysLeft >= 0 ? c.daysLeft + ' din' : 'expired'}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="flex gap-2 items-center">
          {[
            { value: 'all', label: 'Sab' },
            { value: 'active', label: 'Active' },
            { value: 'expired', label: 'Expired' },
          ].map((s) => (
            <button key={s.value} onClick={() => setStatus(s.value)}
              className={status === s.value ? 'pill pill-active' : 'pill'}>{s.label}</button>
          ))}
        </div>
      </div>

      {loading ? <Spinner /> : contracts.length === 0 ? (
        <EmptyState title="Koi contract nahi" message="Pehla vendor contract add karein — expiry reminders khud aayengi." />
      ) : (
        <DataTable
          columns={[
            { key: 'title', label: 'Contract' },
            { key: 'vendor', label: 'Vendor' },
            { key: 'end', label: 'Expiry' },
            { key: 'value', label: 'Value' },
            { key: 'renew', label: 'Auto-renew' },
            { key: 'status', label: 'Status' },
            { key: 'actions', label: '' },
          ]}
          rows={contracts.map((c) => ({
            key: c.id,
            title: <div><div className="font-semibold">{c.title}</div><div className="text-dim text-sm">{c.startDate ? c.startDate.slice(0, 10) : '—'} se</div></div>,
            vendor: c.vendor?.name || '—',
            end: c.endDate ? c.endDate.slice(0, 10) : '—',
            value: c.value != null ? 'Rs ' + Number(c.value).toLocaleString() : '—',
            renew: c.autoRenew ? '🔁 On' : '—',
            status: statusBadge(c),
            actions: (
              <div className="flex gap-2">
                <button className="btn-ghost btn-sm" onClick={() => openRenew(c)} title="Renew">🔄</button>
                <button className="btn-ghost btn-sm" onClick={() => openEdit(c)} title="Edit">✏️</button>
                <button className="btn-ghost btn-sm" onClick={() => remove(c)} title="Delete">🗑️</button>
              </div>
            ),
          }))}
        />
      )}

      {modal && !modal.renew && (
        <Modal title={modal === 'add' ? 'Naya Vendor Contract' : 'Contract Edit karein'} onClose={() => setModal(null)}>
          <div className="grid-2 gap-3">
            <Field label="Vendor">
              <select className="input" value={form.vendorId} onChange={(e) => setF('vendorId', e.target.value)}>
                <option value="">— Select —</option>
                {vendors.filter((v) => v.isActive).map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.company ? ` (${v.company})` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Contract title"><input className="input" value={form.title} onChange={(e) => setF('title', e.target.value)} placeholder="e.g. Annual cleaning contract" /></Field>
            <Field label="Start date"><input type="date" className="input" value={form.startDate} onChange={(e) => setF('startDate', e.target.value)} /></Field>
            <Field label="End date"><input type="date" className="input" value={form.endDate} onChange={(e) => setF('endDate', e.target.value)} /></Field>
            <Field label="Value (Rs)"><input type="number" min="0" className="input" value={form.value} onChange={(e) => setF('value', e.target.value)} /></Field>
            <Field label="Reminder (days before)"><input type="number" min="1" max="365" className="input" value={form.reminderDays} onChange={(e) => setF('reminderDays', e.target.value)} /></Field>
          </div>
          <div className="mt-3">
            <Field label="Document URL (optional)"><input className="input" value={form.documentUrl} onChange={(e) => setF('documentUrl', e.target.value)} placeholder="https://..." /></Field>
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm">
            <input type="checkbox" checked={form.autoRenew} onChange={(e) => setF('autoRenew', e.target.checked)} /> Auto-renew enabled
          </label>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary" disabled={saving || !form.vendorId || !form.title || !form.endDate} onClick={save}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {modal && modal.renew && (
        <Modal title={`Renew: ${modal.renew.title}`} onClose={() => setModal(null)}>
          <p className="text-sm text-dim mb-3">Nayi end date dein — status wapas <b>active</b> ho jayega aur reminder cycle reset ho jayegi.</p>
          <Field label="Nayi end date">
            <input type="date" className="input" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary" disabled={saving || !renewDate} onClick={doRenew}>
              {saving ? 'Renewing...' : '🔄 Renew'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
