'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const STATUS_STYLE = {
  available: 'border-emerald-400/40 bg-emerald-50 hover:bg-emerald-500/20',
  occupied: 'border-red-400/40 bg-red-50 hover:bg-red-500/20',
  reserved: 'border-amber-400/40 bg-amber-50 hover:bg-amber-500/20',
  maintenance: 'border-slate-400/40 bg-slate-500/10 hover:bg-slate-500/20',
};
const STATUS_DOT = {
  available: 'bg-emerald-400',
  occupied: 'bg-red-400',
  reserved: 'bg-amber-400',
  maintenance: 'bg-slate-400',
};
const STATUS_TONE = { available: 'green', occupied: 'red', reserved: 'amber', maintenance: 'slate' };
const SIZE_LABEL = { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra Large' };

function RentForm({ onRent, renting }) {
  const [months, setMonths] = useState(1);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onRent(months); }}>
      <Field label="Duration (months)">
        <select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {[1, 3, 6, 12, 24, 36].map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
        </select>
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={renting}>{renting ? 'Requesting…' : 'Request locker'}</button>
    </form>
  );
}

export default function LockerMapPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'operations_manager', 'member');
  const [lockers, setLockers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showRent, setShowRent] = useState(false);
  const [renting, setRenting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async () => {
    try {
      setError('');
      const r = await api.get('/lockers/available');
      setLockers(r.lockers || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  const groups = useMemo(() => {
    const shown = filter === 'all' ? lockers : lockers.filter((l) => l.status === filter);
    const map = {};
    for (const l of shown) {
      const loc = l.location || 'General';
      if (!map[loc]) map[loc] = [];
      map[loc].push(l);
    }
    return map;
  }, [lockers, filter]);

  const counts = useMemo(() => ({
    available: lockers.filter((l) => l.status === 'available').length,
    occupied: lockers.filter((l) => l.status === 'occupied').length,
    reserved: lockers.filter((l) => l.status === 'reserved').length,
    maintenance: lockers.filter((l) => l.status === 'maintenance').length,
  }), [lockers]);

  const requestRent = async (months) => {
    setRenting(true);
    try {
      await api.post('/locker-rentals/request', { lockerId: selected.id, months });
      setNotice('Locker request sent ✅');
      setShowRent(false);
      setSelected(null);
    } catch (e) { setError(e.message); }
    finally { setRenting(false); }
  };

  if (roleLoading) return <div className="p-5"><Spinner /></div>;
  if (!allowed) return <AccessDenied />;

  return (
    <div className="p-6">
      <PageHeader title="Locker Availability Map" subtitle="Location-wise lockers — status color-coded" />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {notice && <div className="mb-4 rounded-xl border border-emerald-400/40 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{notice}</div>}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        <StatCard label="Total" value={lockers.length} accent="blue" />
        <StatCard label="Available" value={counts.available} accent="green" />
        <StatCard label="Occupied" value={counts.occupied} accent="red" />
        <StatCard label="Reserved" value={counts.reserved} accent="amber" />
        <StatCard label="Maintenance" value={counts.maintenance} accent="slate" />
      </div>
      <div className="flex gap-2 mb-4">
        {['all', 'available', 'occupied', 'reserved', 'maintenance'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold capitalize transition ${filter === f ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-slate-700'}`}>
            {f}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : Object.keys(groups).length === 0 ? (
        <EmptyState title="No lockers" hint="Lockers add hone ke baad map yahan dikhega." />
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([loc, items]) => (
            <div key={loc} className="rounded-2xl border border-gray-200/60 bg-white/60 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">📍 {loc}</h3>
                <Badge tone="blue">{items.length} lockers</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                {items.map((l) => (
                  <button key={l.id} onClick={() => setSelected(l)}
                    className={`rounded-xl border p-3 text-left transition cursor-pointer ${STATUS_STYLE[l.status] || STATUS_STYLE.maintenance}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[l.status] || STATUS_DOT.maintenance}`} />
                      <span className="text-[10px] font-bold text-gray-500">{l.size || 'M'}</span>
                    </div>
                    <div className="text-sm font-extrabold text-gray-900 truncate">{l.code}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Locker ${selected?.code || ''}`}>
        {selected && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Status</span>
              <Badge tone={STATUS_TONE[selected.status] || 'slate'}>{selected.status}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Size</span>
              <span className="text-sm font-semibold text-gray-900">{SIZE_LABEL[selected.size] || selected.size || 'Medium'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Location</span>
              <span className="text-sm font-semibold text-gray-900">{selected.location || 'General'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Monthly rate</span>
              <span className="text-sm font-semibold text-gray-900">{selected.monthlyRate != null ? Number(selected.monthlyRate) : '—'}</span>
            </div>
            {selected.notes && <p className="text-xs text-gray-500 bg-gray-100 rounded-lg p-2.5">{selected.notes}</p>}
            {selected.status === 'available' && (
              <button className="btn-primary w-full" onClick={() => setShowRent(true)}>🔑 Rent this locker</button>
            )}
          </div>
        )}
      </Modal>
      <Modal open={showRent} onClose={() => setShowRent(false)} title={`Rent locker ${selected?.code || ''}`}>
        <RentForm onRent={requestRent} renting={renting} />
      </Modal>
    </div>
  );
}
