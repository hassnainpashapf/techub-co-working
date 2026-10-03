'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const STATUS_STYLE = {
  free: 'border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20',
  occupied: 'border-red-400/40 bg-red-500/10 hover:bg-red-500/20',
  reserved: 'border-amber-400/40 bg-amber-500/10 hover:bg-amber-500/20',
};
const STATUS_DOT = { free: 'bg-emerald-400', occupied: 'bg-red-400', reserved: 'bg-amber-400' };
const STATUS_TONE = { free: 'green', occupied: 'red', reserved: 'amber' };
const TYPE_ICON = { car: '🚗', bike: '🏍️', vip: '⭐' };

function SpotForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    label: initial?.label || '',
    type: initial?.type || 'car',
    status: initial?.status || 'free',
    notes: initial?.notes || '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Spot label *"><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required maxLength={20} placeholder="A-01" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="car">🚗 Car</option>
            <option value="bike">🏍️ Bike</option>
            <option value="vip">⭐ VIP</option>
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="free">Free</option>
            <option value="reserved">Reserved</option>
          </select>
        </Field>
      </div>
      <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save spot'}</button>
    </form>
  );
}

function AssignForm({ members, onSave, saving }) {
  const [f, setF] = useState({ memberId: '', vehicleNumber: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (f.memberId) onSave(f); }}>
      <Field label="Member *">
        <select className="input" value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })} required>
          <option value="">Select member…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.companyName ? ` — ${m.companyName}` : ''}</option>)}
        </select>
      </Field>
      <Field label="Vehicle number"><input className="input" value={f.vehicleNumber} onChange={(e) => setF({ ...f, vehicleNumber: e.target.value })} maxLength={30} placeholder="ABC-123" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.memberId}>{saving ? 'Assigning…' : 'Assign spot'}</button>
    </form>
  );
}

export default function ParkingPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'operations_manager');
  const [spots, setSpots] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignSpot, setAssignSpot] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    try {
      setError('');
      const [s, m] = await Promise.all([
        api.get('/parking/spots'),
        api.get('/members?status=active').catch(() => ({ members: [] })),
      ]);
      setSpots(s.spots || []);
      setMembers(m.members || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  const saveSpot = async (data) => {
    setSaving(true);
    try {
      await api.post('/parking/spots', data);
      setShowForm(false);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const assign = async (data) => {
    setAssigning(true);
    try {
      await api.post('/parking/assign', { ...data, spotId: assignSpot.id });
      setAssignSpot(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setAssigning(false); }
  };

  const release = async (assignmentId) => {
    if (!confirm('Release this parking spot?')) return;
    try {
      await api.post(`/parking/release/${assignmentId}`);
      await load();
    } catch (e) { setError(e.message); }
  };

  const removeSpot = async (id) => {
    if (!confirm('Delete this spot?')) return;
    try {
      await api.del(`/parking/spots/${id}`);
      await load();
    } catch (e) { setError(e.message); }
  };

  if (roleLoading) return <div className="p-8"><Spinner /></div>;
  if (!allowed) return <AccessDenied />;

  const counts = {
    free: spots.filter((s) => s.status === 'free').length,
    occupied: spots.filter((s) => s.status === 'occupied').length,
    reserved: spots.filter((s) => s.status === 'reserved').length,
  };
  const shown = filter === 'all' ? spots : spots.filter((s) => s.status === filter);

  return (
    <div className="p-6">
      <PageHeader title="Parking Management" subtitle="Spots, assignments and releases" action={
        <button className="btn-primary" onClick={() => setShowForm(true)}>+ Add spot</button>
      } />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total spots" value={spots.length} accent="blue" />
        <StatCard label="Free" value={counts.free} accent="green" />
        <StatCard label="Occupied" value={counts.occupied} accent="red" />
        <StatCard label="Reserved" value={counts.reserved} accent="amber" />
      </div>
      <div className="flex gap-2 mb-4">
        {['all', 'free', 'occupied', 'reserved'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold capitalize transition ${filter === f ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
            {f}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : shown.length === 0 ? (
        <EmptyState title="No spots" hint="Add parking spots to get started." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {shown.map((s) => {
            const active = s.assignments?.[0];
            return (
              <div key={s.id} className={`rounded-2xl border p-4 transition ${STATUS_STYLE[s.status]}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{TYPE_ICON[s.type] || '🚗'}</span>
                  <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[s.status]}`} />
                </div>
                <div className="text-lg font-extrabold text-white">{s.label}</div>
                <div className="mb-3"><Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge></div>
                {active ? (
                  <div className="text-xs text-slate-300 mb-3">
                    <div className="font-semibold text-white truncate">{active.member?.name}</div>
                    <div className="truncate opacity-70">{active.vehicleNumber || '—'}</div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 mb-3 capitalize">{s.type}</div>
                )}
                <div className="flex gap-2">
                  {s.status === 'free' && (
                    <button className="btn-primary btn-sm flex-1" onClick={() => setAssignSpot(s)}>Assign</button>
                  )}
                  {active && (
                    <button className="btn-secondary btn-sm flex-1" onClick={() => release(active.id)}>Release</button>
                  )}
                  {s.status !== 'occupied' && (
                    <button className="btn-ghost btn-sm" onClick={() => removeSpot(s.id)} title="Delete spot">🗑️</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Add parking spot">
        <SpotForm onSave={saveSpot} saving={saving} />
      </Modal>
      <Modal open={!!assignSpot} onClose={() => setAssignSpot(null)} title={`Assign spot ${assignSpot?.label || ''}`}>
        <AssignForm members={members} onSave={assign} saving={assigning} />
      </Modal>
    </div>
  );
}
