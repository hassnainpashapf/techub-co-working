'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
  EmptyState,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const STATUS_COLORS = {
  vacant: 'border-green-400/40 bg-green-500/10',
  occupied: 'border-[#0f766e]/40 bg-[#0f766e]/10',
  maintenance: 'border-amber-400/40 bg-amber-50',
};
const STATUS_TONE = { vacant: 'green', occupied: 'violet', maintenance: 'amber' };

function FloorForm({ initial, buildings, onSave, saving }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    level: initial?.level ?? '',
    buildingId: initial?.buildingId || initial?.building?.id || '',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: form.name,
          level: form.level === '' ? undefined : Number(form.level),
          buildingId: form.buildingId || undefined,
        });
      }}
    >
      <Field label="Floor name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ground Floor" /></Field>
      <Field label="Level"><input type="number" className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} placeholder="0" /></Field>
      <Field label="Building">
        <select className="input" value={form.buildingId} onChange={(e) => setForm({ ...form, buildingId: e.target.value })}>
          <option value="">— No building —</option>
          {(buildings || []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save floor'}</button>
    </form>
  );
}

function BuildingForm({ initial, onSave, saving }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    address: initial?.address || '',
    city: initial?.city || '',
    phone: initial?.phone || '',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: form.name, address: form.address || undefined, city: form.city || undefined, phone: form.phone || undefined });
      }}
    >
      <Field label="Building name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Gulberg Campus" /></Field>
      <Field label="Address"><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Main Boulevard, Gulberg, Lahore" /></Field>
      <Field label="City"><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Lahore" /></Field>
      <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0300-1234567" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save building'}</button>
    </form>
  );
}

function ZoneForm({ initial, onSave, saving }) {
  const [form, setForm] = useState({ name: initial?.name || '', description: initial?.description || '' });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: form.name, description: form.description });
      }}
    >
      <Field label="Zone name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Zone A" /></Field>
      <Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Hot desks area" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save zone'}</button>
    </form>
  );
}

function UnitForm({ initial, onSave, saving }) {
  const [form, setForm] = useState({
    code: initial?.code || '',
    type: initial?.type || 'desk',
    monthlyPrice: initial?.monthlyPrice ?? '',
    status: initial?.status || 'vacant',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...form, monthlyPrice: Number(form.monthlyPrice) || 0 });
      }}
    >
      <Field label="Unit code"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="D-101" /></Field>
      <Field label="Type">
        <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="desk">Hot desk</option>
          <option value="dedicated_desk">Dedicated desk</option>
          <option value="private_office">Private office</option>
          <option value="meeting_room">Meeting room</option>
          <option value="cabin">Cabin</option>
        </select>
      </Field>
      <Field label="Monthly price (Rs)"><input type="number" min="0" className="input" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} required /></Field>
      <Field label="Status">
        <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="vacant">Vacant</option>
          <option value="occupied">Occupied</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save unit'}</button>
    </form>
  );
}

export default function SpacesPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'receptionist');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buildings, setBuildings] = useState([]);
  const [buildingFilter, setBuildingFilter] = useState('');
  const [floors, setFloors] = useState([]);
  const [activeFloor, setActiveFloor] = useState(null);
  const [zones, setZones] = useState([]);
  const [units, setUnits] = useState([]);
  const [modal, setModal] = useState(null); // {kind:'building'|'floor'|'zone'|'unit', mode:'add'|'edit', data}
  const [saving, setSaving] = useState(false);

  const loadBuildings = async () => {
    const d = await api.get('/buildings');
    const list = d.buildings || d || [];
    setBuildings(list);
    return list;
  };

  const loadFloors = async (filter) => {
    const f = filter === undefined ? buildingFilter : filter;
    const q = f ? `?buildingId=${encodeURIComponent(f)}` : '';
    const d = await api.get(`/spaces/floors${q}`);
    const list = d.floors || d || [];
    setFloors(list);
    if (list.length && !activeFloor) setActiveFloor(list[0].id);
    return list;
  };

  const loadDetail = async (floorId) => {
    if (!floorId) return;
    const d = await api.get(`/spaces/floors/${floorId}`);
    setZones(d.zones || []);
    setUnits(d.units || []);
  };

  const refresh = async () => {
    setError('');
    try {
      await loadBuildings();
      const list = await loadFloors();
      const fid = activeFloor || list[0]?.id;
      if (fid) await loadDetail(fid);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeFloor && !loading) loadDetail(activeFloor).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFloor]);

  // Reload the floor list when the building filter changes.
  useEffect(() => {
    if (loading) return;
    (async () => {
      setActiveFloor(null);
      setZones([]);
      setUnits([]);
      const list = await loadFloors(buildingFilter);
      const fid = list[0]?.id;
      if (fid) {
        setActiveFloor(fid);
        await loadDetail(fid);
      }
    })().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingFilter]);

  const occupancy = useMemo(() => {
    const total = units.length;
    const occupied = units.filter((u) => u.status === 'occupied').length;
    const vacant = units.filter((u) => u.status === 'vacant').length;
    const maintenance = units.filter((u) => u.status === 'maintenance').length;
    return { total, occupied, vacant, maintenance, pct: total ? Math.round((occupied / total) * 100) : 0 };
  }, [units]);

  async function handleSave(payload) {
    setSaving(true);
    try {
      const { kind, mode, data } = modal;
      if (kind === 'building') {
        if (mode === 'add') await api.post('/buildings', payload);
        else await api.patch(`/buildings/${data.id}`, payload);
        await loadBuildings();
        const list = await loadFloors();
        await loadDetail(activeFloor || list[0]?.id);
      } else if (kind === 'floor') {
        if (mode === 'add') await api.post('/spaces/floors', payload);
        else await api.patch(`/spaces/floors/${data.id}`, payload);
        const list = await loadFloors();
        await loadDetail(activeFloor || list[0]?.id);
      } else if (kind === 'zone') {
        if (mode === 'add') await api.post(`/spaces/floors/${activeFloor}/zones`, payload);
        else await api.put(`/spaces/zones/${data.id}`, payload);
        await loadDetail(activeFloor);
      } else if (kind === 'unit') {
        const zoneId = data?.zoneId || zones[0]?.id;
        if (mode === 'add') await api.post(`/spaces/zones/${zoneId}/units`, payload);
        else await api.put(`/spaces/units/${data.id}`, payload);
        await loadDetail(activeFloor);
      }
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(kind, id) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    setError('');
    try {
      if (kind === 'building') {
        await api.del(`/buildings/${id}`);
        await loadBuildings();
        setActiveFloor(null);
        setZones([]);
        setUnits([]);
        const list = await loadFloors();
        const fid = list[0]?.id;
        if (fid) {
          setActiveFloor(fid);
          await loadDetail(fid);
        }
      } else if (kind === 'floor') {
        await api.del(`/spaces/floors/${id}`);
        setActiveFloor(null);
        setZones([]);
        setUnits([]);
        await loadFloors().then(async (list) => {
          const fid = list[0]?.id;
          if (fid) {
            setActiveFloor(fid);
            await loadDetail(fid);
          }
        });
      } else if (kind === 'zone') {
        await api.del(`/spaces/zones/${id}`);
        await loadDetail(activeFloor);
      } else if (kind === 'unit') {
        await api.del(`/spaces/units/${id}`);
        await loadDetail(activeFloor);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Spaces"
        sub="Buildings, floors, zones and rentable units"
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setModal({ kind: 'building', mode: 'add' })}>
              + Add building
            </button>
            <button className="btn-primary" onClick={() => setModal({ kind: 'floor', mode: 'add' })}>
              + Add floor
            </button>
          </div>
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />

      {/* Buildings */}
      <div className="card mb-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Buildings</h2>
          <button className="btn-primary btn-sm" onClick={() => setModal({ kind: 'building', mode: 'add' })}>+ Add building</button>
        </div>
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'city', label: 'City', render: (r) => r.city || '—' },
            { key: 'address', label: 'Address', render: (r) => r.address || '—' },
            { key: 'floors', label: 'Floors', render: (r) => r._count?.floors ?? '—' },
            {
              key: 'status',
              label: 'Status',
              render: (r) => <Badge tone={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>,
            },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) => (
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={() => setModal({ kind: 'building', mode: 'edit', data: r })}>Edit</button>
                  <button className="btn-danger btn-sm" onClick={() => handleDelete('building', r.id)}>Delete</button>
                </div>
              ),
            },
          ]}
          rows={buildings}
          empty={{ title: 'No buildings', hint: 'Add a building to group floors by location.' }}
        />
      </div>

      {/* Building filter */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-sm text-gray-500">Building:</label>
        <select className="input max-w-xs" value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)}>
          <option value="">All buildings</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {/* Floor tabs */}
      <div className="flex flex-wrap gap-2 mb-3">
        {floors.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFloor(f.id)}
            className={`chip ${activeFloor === f.id ? 'bg-teal-700 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
          >
            {f.name}{f.building?.name ? ` · ${f.building.name}` : ''}
          </button>
        ))}
        {floors.length === 0 && <EmptyState title="No floors yet" hint="Add your first floor to get started." />}
      </div>

      {activeFloor && (
        <>
          {/* Occupancy summary */}
          <div className="card mb-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-900">Occupancy</h2>
              <span className="text-sm font-medium text-gray-500">{occupancy.pct}% occupied</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex">
              <div className="bg-[#0f766e]" style={{ width: `${occupancy.total ? (occupancy.occupied / occupancy.total) * 100 : 0}%` }} />
              <div className="bg-amber-400" style={{ width: `${occupancy.total ? (occupancy.maintenance / occupancy.total) * 100 : 0}%` }} />
              <div className="bg-green-400" style={{ width: `${occupancy.total ? (occupancy.vacant / occupancy.total) * 100 : 0}%` }} />
            </div>
            <div className="flex gap-3 mt-2 text-xs text-gray-500">
              <span>🟦 Occupied: {occupancy.occupied}</span>
              <span>🟩 Vacant: {occupancy.vacant}</span>
              <span>🟨 Maintenance: {occupancy.maintenance}</span>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => {
                const f = floors.find((x) => x.id === activeFloor);
                setModal({ kind: 'floor', mode: 'edit', data: f });
              }}>Edit floor</button>
              <button className="btn-danger btn-sm" onClick={() => handleDelete('floor', activeFloor)}>Delete floor</button>
              <button className="btn-primary btn-sm" onClick={() => setModal({ kind: 'zone', mode: 'add' })}>+ Add zone</button>
            </div>
          </div>

          {/* Zones */}
          <div className="card mb-3">
            <h2 className="font-semibold text-gray-900 mb-3">Zones</h2>
            <DataTable
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'description', label: 'Description', render: (r) => r.description || '—' },
                { key: 'units', label: 'Units', render: (r) => units.filter((u) => u.zoneId === r.id).length },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (r) => (
                    <div className="flex gap-2">
                      <button className="btn-secondary btn-sm" onClick={() => setModal({ kind: 'zone', mode: 'edit', data: r })}>Edit</button>
                      <button className="btn-secondary btn-sm" onClick={() => setModal({ kind: 'unit', mode: 'add', data: { zoneId: r.id } })}>+ Unit</button>
                      <button className="btn-danger btn-sm" onClick={() => handleDelete('zone', r.id)}>Delete</button>
                    </div>
                  ),
                },
              ]}
              rows={zones}
              empty={{ title: 'No zones', hint: 'Add a zone to organize units.' }}
            />
          </div>

          {/* Units grid */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">Units</h2>
              <button className="btn-primary btn-sm" onClick={() => setModal({ kind: 'unit', mode: 'add', data: { zoneId: zones[0]?.id } })}>+ Add unit</button>
            </div>
            {units.length === 0 ? (
              <EmptyState title="No units" hint="Add units to start renting." />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {units.map((u) => (
                  <div key={u.id} className={`border rounded-xl p-3 ${STATUS_COLORS[u.status] || 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-gray-900">{u.code}</span>
                      <Badge tone={STATUS_TONE[u.status] || 'slate'}>{u.status || 'vacant'}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 capitalize">{(u.type || '').replace(/_/g, ' ')}</p>
                    <p className="text-sm font-semibold text-gray-900 mt-1">
                      Rs {Number(u.monthlyPrice || 0).toLocaleString()}/mo
                    </p>
                    <div className="flex gap-1.5 mt-2">
                      <button className="btn-secondary btn-sm" onClick={() => setModal({ kind: 'unit', mode: 'edit', data: u })}>Edit</button>
                      <button className="btn-danger btn-sm" onClick={() => handleDelete('unit', u.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {modal?.kind === 'building' && (
        <Modal title={modal.mode === 'add' ? 'Add building' : 'Edit building'} onClose={() => setModal(null)}>
          <BuildingForm initial={modal.data} onSave={handleSave} saving={saving} />
        </Modal>
      )}
      {modal?.kind === 'floor' && (
        <Modal title={modal.mode === 'add' ? 'Add floor' : 'Edit floor'} onClose={() => setModal(null)}>
          <FloorForm initial={modal.data} buildings={buildings} onSave={handleSave} saving={saving} />
        </Modal>
      )}
      {modal?.kind === 'zone' && (
        <Modal title={modal.mode === 'add' ? 'Add zone' : 'Edit zone'} onClose={() => setModal(null)}>
          <ZoneForm initial={modal.data} onSave={handleSave} saving={saving} />
        </Modal>
      )}
      {modal?.kind === 'unit' && (
        <Modal title={modal.mode === 'add' ? 'Add unit' : 'Edit unit'} onClose={() => setModal(null)}>
          <UnitForm initial={modal.data} onSave={handleSave} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
