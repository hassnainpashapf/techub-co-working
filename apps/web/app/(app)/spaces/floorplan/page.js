'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Spinner, ErrorBanner, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const WRITE_ROLES = ['ceo', 'admin', 'manager', 'operations_manager'];

const STATUS_STYLE = {
  vacant: 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200',
  occupied: 'bg-red-500/15 border-red-400/50 text-red-200',
  reserved: 'bg-amber-500/15 border-amber-400/50 text-amber-200',
  maintenance: 'bg-slate-500/15 border-slate-400/50 text-slate-200',
};

const TYPE_LABEL = {
  hot_desk: 'Hot Desk',
  dedicated_desk: 'Dedicated',
  cabin: 'Cabin',
  meeting_room: 'Meeting',
  phone_booth: 'Phone Booth',
};

const GRID_COLS = 8;
const GRID_ROWS = 6;

export default function FloorPlanPage() {
  const { allowed, user } = useRequireRoles(['ceo', 'admin', 'manager', 'receptionist', 'operations_manager', 'finance_manager', 'member']);
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState([]);
  const [units, setUnits] = useState([]);
  const [buildingId, setBuildingId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const canWrite = user && WRITE_ROLES.includes(user.role);

  useEffect(() => {
    if (!allowed) return;
    Promise.all([api.get('/buildings'), api.get('/spaces/floors')])
      .then(([b, f]) => {
        setBuildings(b.buildings || []);
        setFloors(f.floors || []);
        if (b.buildings?.length) setBuildingId(b.buildings[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [allowed]);

  const buildingFloors = useMemo(
    () => floors.filter((f) => f.buildingId === buildingId),
    [floors, buildingId]
  );

  useEffect(() => {
    if (buildingFloors.length && !buildingFloors.find((f) => f.id === floorId)) {
      setFloorId(buildingFloors[0].id);
    }
  }, [buildingFloors, floorId]);

  useEffect(() => {
    if (!floorId || !allowed) return;
    setLoading(true);
    api.get('/spaces/units')
      .then((d) => {
        const all = d.units || [];
        setUnits(all.filter((u) => u.zone?.floor?.id === floorId));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [floorId, allowed]);

  if (!allowed) return <AccessDenied />;

  const gridMap = useMemo(() => {
    const map = {};
    for (const u of units) map[`${u.posX},${u.posY}`] = u;
    return map;
  }, [units]);

  const handleCellClick = async (x, y) => {
    if (!editMode || !selected || !canWrite) return;
    if (gridMap[`${x},${y}`]) { setError('Cell already occupied'); return; }
    setSaving(true);
    try {
      await api.patch(`/spaces/units/${selected.id}`, { posX: x, posY: y });
      setUnits((prev) => prev.map((u) => (u.id === selected.id ? { ...u, posX: x, posY: y } : u)));
      setSelected({ ...selected, posX: x, posY: y });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const autoLayout = async () => {
    if (!canWrite) return;
    setSaving(true);
    try {
      let i = 0;
      for (const u of units) {
        const x = i % GRID_COLS;
        const y = Math.floor(i / GRID_COLS);
        if (u.posX !== x || u.posY !== y) {
          await api.patch(`/spaces/units/${u.id}`, { posX: x, posY: y });
        }
        i++;
      }
      const refreshed = await api.get('/spaces/units');
      setUnits((refreshed.units || []).filter((u) => u.zone?.floor?.id === floorId));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const cells = [];
  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      cells.push({ x, y, unit: gridMap[`${x},${y}`] });
    }
  }

  return (
    <div>
      <PageHeader
        title="Floor Plan"
        subtitle="Visual layout of units"
        action={canWrite ? (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={autoLayout} disabled={saving}>{saving ? 'Working…' : 'Auto Layout'}</button>
            <button className={editMode ? 'btn-primary' : 'btn-secondary'} onClick={() => { setEditMode(!editMode); setSelected(null); }}>
              {editMode ? 'Done Editing' : 'Edit Layout'}
            </button>
          </div>
        ) : null}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="flex flex-wrap gap-4 mb-5">
        <Field label="Building">
          <select className="input min-w-[200px]" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Floor">
          <select className="input min-w-[200px]" value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            {buildingFloors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      </div>

      {loading ? <Spinner /> : (
        <>
          {editMode && <div className="mb-3 text-sm text-violet-300">✏️ Edit mode: click a unit to select it, then click an empty cell to move it.</div>}
          <div className="card-premium p-4 overflow-x-auto">
            <div className="grid gap-1.5 min-w-[600px]" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
              {cells.map(({ x, y, unit }) => (
                <div
                  key={`${x},${y}`}
                  onClick={() => (unit ? setSelected(unit) : handleCellClick(x, y))}
                  className={`aspect-square rounded-lg border flex flex-col items-center justify-center text-center p-1 cursor-pointer transition-all ${
                    unit
                      ? `${STATUS_STYLE[unit.status] || STATUS_STYLE.vacant} ${selected?.id === unit.id ? 'ring-2 ring-violet-400 scale-105' : 'hover:scale-105'}`
                      : editMode
                        ? 'border-dashed border-white/15 bg-white/[0.02] hover:bg-violet-500/10 hover:border-violet-400/40'
                        : 'border-white/5 bg-white/[0.02]'
                  }`}
                >
                  {unit ? (
                    <>
                      <span className="text-xs font-bold">{unit.code}</span>
                      <span className="text-[10px] opacity-75">{TYPE_LABEL[unit.type] || unit.type}</span>
                    </>
                  ) : editMode ? (
                    <span className="text-white/20 text-lg">+</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-300">
            {Object.entries({ vacant: 'Vacant', occupied: 'Occupied', reserved: 'Reserved', maintenance: 'Maintenance' }).map(([k, l]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded border ${STATUS_STYLE[k]}`} />{l}
              </span>
            ))}
            <span className="text-slate-500">{units.length} units on this floor</span>
          </div>
        </>
      )}

      {selected && (
        <Modal title={`Unit ${selected.code}`} onClose={() => setSelected(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-slate-400">Type</div><div className="text-white">{TYPE_LABEL[selected.type] || selected.type}</div></div>
              <div><div className="text-xs text-slate-400">Status</div><Badge tone={selected.status === 'vacant' ? 'green' : selected.status === 'occupied' ? 'red' : 'amber'}>{selected.status}</Badge></div>
              <div><div className="text-xs text-slate-400">Zone</div><div className="text-white">{selected.zone?.name || '—'}</div></div>
              <div><div className="text-xs text-slate-400">Monthly price</div><div className="text-white">Rs {Number(selected.monthlyPrice).toLocaleString()}</div></div>
              <div><div className="text-xs text-slate-400">Capacity</div><div className="text-white">{selected.capacity}</div></div>
              <div><div className="text-xs text-slate-400">Position</div><div className="text-white">({selected.posX}, {selected.posY})</div></div>
            </div>
            {canWrite && !editMode && (
              <button className="btn-secondary w-full" onClick={() => { setEditMode(true); }}>Move on floor plan</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
