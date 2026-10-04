'use client';

// Phase 56 Track 1/10: Locker Inventory (staff).
// API contract: GET /api/lockers (staff) → { lockers, counts }; POST/PATCH/DELETE.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge, Modal, Field } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const SIZES = ['S', 'M', 'L', 'XL'];
const STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];

function statusTone(s) {
  return { available: 'green', occupied: 'blue', reserved: 'amber', maintenance: 'red' }[s] || 'blue';
}

function LockerForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    code: initial?.code || '',
    location: initial?.location || '',
    size: initial?.size || 'M',
    status: initial?.status || 'available',
    monthlyRate: initial?.monthlyRate ?? '',
    notes: initial?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.code.trim()) { setErr('Code lazmi hai'); return; }
    setSaving(true);
    try {
      const body = {
        code: form.code.trim(),
        location: form.location.trim() || null,
        size: form.size,
        status: form.status,
        monthlyRate: form.monthlyRate === '' ? null : Number(form.monthlyRate),
        notes: form.notes.trim() || null,
      };
      if (initial?.id) await api.patch(`/api/lockers/${initial.id}`, body);
      else await api.post('/api/lockers', body);
      onSave();
    } catch (ex) {
      setErr(ex.message || 'Save nahi ho saka');
    } finally { setSaving(false); }
  };

  return (
    <Modal title={initial?.id ? 'Locker Edit Karein' : 'Naya Locker'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <ErrorBanner message={err} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code *"><input className="input" value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="L-101" /></Field>
          <Field label="Location"><input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Floor 2, Zone A" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Size">
            <select className="input" value={form.size} onChange={(e) => set('size', e.target.value)}>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Monthly Rate"><input type="number" min="0" className="input" value={form.monthlyRate} onChange={(e) => set('monthlyRate', e.target.value)} placeholder="0" /></Field>
        <Field label="Notes"><textarea className="input" rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function LockersPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'reception');
  const [lockers, setLockers] = useState([]);
  const [counts, setCounts] = useState([]);
  const [statusF, setStatusF] = useState('');
  const [sizeF, setSizeF] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | locker

  const load = async () => {
    try {
      setLoading(true); setErr('');
      const params = new URLSearchParams();
      if (statusF) params.set('status', statusF);
      if (sizeF) params.set('size', sizeF);
      if (q) params.set('search', q);
      const r = await api.get(`/api/lockers${params.toString() ? `?${params.toString()}` : ''}`);
      setLockers(r.lockers || []);
      setCounts(r.counts || []);
    } catch (e) {
      setErr(e.message || 'Load nahi ho saka');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [statusF, sizeF]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const total = lockers.length;
  const doDelete = async (id) => {
    if (!window.confirm('Locker delete karein?')) return;
    try { await api.del(`/api/lockers/${id}`); load(); }
    catch (e) { setErr(e.message || 'Delete nahi ho saka'); }
  };
  const setStatus = async (locker, status) => {
    try { await api.patch(`/api/lockers/${locker.id}`, { status }); load(); }
    catch (e) { setErr(e.message || 'Status update nahi ho saka'); }
  };

  return (
    <div className="p-6 space-y-3">
      <PageHeader title="🔐 Locker Inventory" subtitle="Lockers manage karein (code, size, status, rate)">
        <button className="btn-primary" onClick={() => setModal('new')}>+ Naya Locker</button>
      </PageHeader>

      {err && <ErrorBanner message={err} />}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Lockers" value={total} />
        <StatCard label="Available" value={byStatus.available || 0} />
        <StatCard label="Occupied" value={byStatus.occupied || 0} />
        <StatCard label="Reserved" value={byStatus.reserved || 0} />
        <StatCard label="Maintenance" value={byStatus.maintenance || 0} />
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-500">Search</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Code ya location…" />
        </div>
        <div>
          <label className="text-xs text-gray-500">Status</label>
          <select className="input" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">Sab</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500">Size</label>
          <select className="input" value={sizeF} onChange={(e) => setSizeF(e.target.value)}>
            <option value="">Sab</option>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn-secondary" onClick={load}>Apply</button>
      </div>

      {lockers.length === 0 ? (
        <EmptyState title="Koi locker nahi" message="Pehla locker add karein" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {lockers.map((l) => (
            <div key={l.id} className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-lg">{l.code}</div>
                <Badge tone={statusTone(l.status)}>{l.status}</Badge>
              </div>
              <div className="text-sm text-gray-500">{l.location || '—'} · Size {l.size}</div>
              <div className="text-sm">{l.monthlyRate != null ? `Rs ${Number(l.monthlyRate).toLocaleString()}/mo` : 'Rate set nahi'}</div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button className="btn-secondary btn-sm" onClick={() => setModal(l)}>Edit</button>
                {l.status !== 'occupied' && (
                  <button className="btn-secondary btn-sm" onClick={() => doDelete(l.id)}>Delete</button>
                )}
                <select
                  className="input input-sm"
                  value={l.status}
                  onChange={(e) => setStatus(l, e.target.value)}
                  title="Status badlein"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <LockerForm
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
