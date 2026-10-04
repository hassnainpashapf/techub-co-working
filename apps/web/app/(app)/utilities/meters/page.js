'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, DataTable, Modal, Field, Badge, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const TYPES = [
  { value: 'electricity', label: '⚡ Electricity' },
  { value: 'water', label: '💧 Water' },
  { value: 'gas', label: '🔥 Gas' },
  { value: 'internet', label: '🌐 Internet' },
];
const typeLabel = (t) => (TYPES.find((x) => x.value === t) || {}).label || t;

const emptyForm = { name: '', type: 'electricity', unitId: '', buildingId: '', meterNumber: '', isActive: true };

export default function MetersPage() {
  const { allowed, loading: roleLoading } = useRequireRoles(['ceo', 'admin', 'super_admin', 'manager']);
  const [meters, setMeters] = useState([]);
  const [units, setUnits] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // null | {mode:'add'|'edit'}
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  // Phase 51: readings tab state
  const [readingsModal, setReadingsModal] = useState(null); // { meter }
  const [readings, setReadings] = useState([]);
  const [readingsLoading, setReadingsLoading] = useState(false);
  const [newReading, setNewReading] = useState('');
  const [readingMsg, setReadingMsg] = useState('');

  const openReadings = async (meter) => {
    setReadingsModal({ meter }); setReadings([]); setNewReading(''); setReadingMsg('');
    setReadingsLoading(true);
    try {
      const d = await api.get(`/meter-readings?meterId=${meter.id}&consumption=1&limit=30`);
      setReadings(d.items || d.readings || []);
    } catch (e) { setReadingMsg(e.message); }
    finally { setReadingsLoading(false); }
  };

  const saveReading = async () => {
    if (!newReading || isNaN(Number(newReading))) { setReadingMsg('Reading number me likhein'); return; }
    setReadingMsg('');
    try {
      const d = await api.post('/meter-readings', { meterId: readingsModal.meter.id, reading: Number(newReading) });
      setReadingMsg(`✅ Saved — consumption: ${d.consumption ?? '—'}`);
      setNewReading('');
      const r = await api.get(`/meter-readings?meterId=${readingsModal.meter.id}&consumption=1&limit=30`);
      setReadings(r.items || r.readings || []);
    } catch (e) { setReadingMsg('❌ ' + e.message); }
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [m, u, b] = await Promise.all([
        api.get('/meters'),
        api.get('/units').catch(() => ({ units: [] })),
        api.get('/buildings').catch(() => ({ buildings: [] })),
      ]);
      setMeters(m.meters || []);
      setUnits(m.units || u.units || []);
      setBuildings(b.buildings || []);
    } catch (e) { setError(e.message || 'Load failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (roleLoading) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const openAdd = () => { setForm(emptyForm); setModal({ mode: 'add' }); };
  const openEdit = (meter) => {
    setForm({
      name: meter.name || '', type: meter.type || 'electricity',
      unitId: meter.unitId || '', buildingId: meter.buildingId || '',
      meterNumber: meter.meterNumber || '', isActive: meter.isActive !== false,
    });
    setModal({ mode: 'edit', id: meter.id });
  };

  const save = async () => {
    if (!form.name.trim()) { setError('Meter ka naam lazmi hai'); return; }
    setSaving(true); setError('');
    const payload = {
      name: form.name.trim(), type: form.type,
      unitId: form.unitId || null, buildingId: form.buildingId || null,
      meterNumber: form.meterNumber.trim() || null, isActive: form.isActive,
    };
    try {
      if (modal.mode === 'add') await api.post('/meters', payload);
      else await api.patch(`/meters/${modal.id}`, payload);
      setModal(null); await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const toggle = async (meter) => {
    try { await api.patch(`/meters/${meter.id}/active`, { isActive: !meter.isActive }); await load(); }
    catch (e) { setError(e.message); }
  };

  const remove = async (meter) => {
    if (!window.confirm(`"${meter.name}" meter delete karein?`)) return;
    try { await api.del(`/meters/${meter.id}`); await load(); }
    catch (e) { setError(e.message); }
  };

  const columns = [
    { key: 'name', label: 'Meter' },
    { key: 'type', label: 'Type', render: (m) => typeLabel(m.type) },
    { key: 'unit', label: 'Unit', render: (m) => (m.unit ? m.unit.code : <span className="text-slate-500">—</span>) },
    { key: 'building', label: 'Building', render: (m) => (m.building ? m.building.name : <span className="text-slate-500">Shared</span>) },
    { key: 'meterNumber', label: 'Meter #', render: (m) => m.meterNumber || <span className="text-slate-500">—</span> },
    { key: 'status', label: 'Status', render: (m) => <Badge tone={m.isActive ? 'green' : 'slate'}>{m.isActive ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', label: 'Actions', render: (m) => (
        <div className="flex gap-2">
          <button className="text-xs text-emerald-700 hover:text-emerald-700" onClick={() => openReadings(m)}>📊 Readings</button>
          <button className="text-xs text-teal-700 hover:text-teal-700" onClick={() => openEdit(m)}>Edit</button>
          <button className="text-xs text-amber-700 hover:text-amber-700" onClick={() => toggle(m)}>{m.isActive ? 'Deactivate' : 'Activate'}</button>
          <button className="text-xs text-red-400 hover:text-red-700" onClick={() => remove(m)}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="🔌 Utility Meters"
        sub="Bijli, pani, gas aur internet meters — units ya building level par"
        actions={<button onClick={openAdd} className="rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f766e]">+ Naya Meter</button>}
      />
      {error && <ErrorBanner message={error} />}
      {loading ? <Spinner /> : <DataTable columns={columns} rows={meters} emptyText="Koi meter nahi — pehla meter add karein." />}

      {readingsModal && (
        <Modal title={`📊 Readings — ${readingsModal.meter.name}`} onClose={() => setReadingsModal(null)}>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Field label="New Reading">
                <input type="number" step="0.01" className="input-premium w-full" value={newReading}
                  onChange={(e) => setNewReading(e.target.value)} placeholder="e.g. 1250.5" />
              </Field>
              <div className="flex items-end pb-1">
                <button onClick={saveReading} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Save</button>
              </div>
            </div>
            {readingMsg && <div className="text-sm text-gray-600">{readingMsg}</div>}
            {readingsLoading ? <Spinner /> : (
              <DataTable
                columns={[
                  { key: 'readAt', label: 'Date', render: (r) => new Date(r.readAt).toLocaleString() },
                  { key: 'reading', label: 'Reading' },
                  { key: 'consumption', label: 'Consumption', render: (r) => (r.consumption ?? '—') },
                ]}
                rows={readings} emptyText="Abhi koi reading nahi."
              />
            )}
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title={modal.mode === 'add' ? 'Naya Meter' : 'Meter Edit Karein'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Field label="Meter Name *">
              <input className="input-premium w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main Electricity Meter" />
            </Field>
            <Field label="Utility Type">
              <select className="input-premium w-full" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit (optional)">
                <select className="input-premium w-full" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                  <option value="">Shared / Building level</option>
                  {(units || []).map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </select>
              </Field>
              <Field label="Building (optional)">
                <select className="input-premium w-full" value={form.buildingId} onChange={(e) => setForm({ ...form, buildingId: e.target.value })}>
                  <option value="">—</option>
                  {(buildings || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Meter Number (optional)">
              <input className="input-premium w-full" value={form.meterNumber} onChange={(e) => setForm({ ...form, meterNumber: e.target.value })} placeholder="Physical meter serial" />
            </Field>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModal(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f766e] disabled:opacity-50">
                {saving ? 'Saving...' : modal.mode === 'add' ? 'Add Meter' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
