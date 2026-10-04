'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { Spinner, Modal, Field, ErrorBanner } from '../../../components/ui';

const WORKSPACE_TYPES = [
  { label: 'Co-working space', types: ['hot_desk', 'dedicated_desk'] },
  { label: 'Private office', types: ['cabin'] },
  { label: 'Virtual office', types: ['virtual_office'] },
  { label: 'Accommodations', types: ['accommodation'] },
  { label: 'R & D Lab', types: ['meeting_room', 'phone_booth'] },
];

const TYPE_LABELS = {
  hot_desk: 'Hot Desk', dedicated_desk: 'Dedicated Desk', cabin: 'Private Cabin',
  meeting_room: 'Meeting Room', phone_booth: 'Phone Booth',
  virtual_office: 'Virtual Office', accommodation: 'Accommodation',
};

const IMAGES = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&q=90&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=900&q=90&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=900&q=90&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?w=900&q=90&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1541746972996-4e0b0f43e02a?w=900&q=90&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1517502884422-41eaead166d4?w=900&q=90&auto=format&fit=crop',
];

const DURATIONS = [
  { label: 'Hourly', divisor: 720, suffix: '/hr' },
  { label: 'Daily', divisor: 30, suffix: '/day' },
  { label: 'Weekly', divisor: 4, suffix: '/week' },
  { label: 'Monthly', divisor: 1, suffix: '/mo' },
];
const BUDGETS = [
  { label: 'Under Rs 20k', max: 20000 },
  { label: 'Rs 20k – 50k', min: 20000, max: 50000 },
  { label: 'Rs 50k+', min: 50000 },
];
const FREEBIES = ['Wi-fi', 'AC', 'Coffee', 'Parking'];

const SORT_OPTIONS = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-low', label: 'Price: Low to High' },
  { value: 'price-high', label: 'Price: High to Low' },
  { value: 'name', label: 'Name A–Z' },
];

const money = (n) => `Rs ${Math.round(Number(n || 0)).toLocaleString()}`;

function FilterSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.06] pb-5 mb-5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-white text-[15px] font-semibold mb-1 hover:text-blue-200 transition-colors"
      >
        {title}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 text-white ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function formatDateDisplay(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function DateField({ label, value, onChange }) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] text-white font-semibold mb-1.5">{label}</label>
      <div className="relative">
        <input
          type="text"
          readOnly
          value={formatDateDisplay(value)}
          onClick={(e) => e.target.previousElementSibling?.showPicker?.()}
          className="w-full bg-transparent border border-white/[0.12] rounded-xl pl-3.5 pr-10 py-2.5 text-[13.5px] text-white outline-none focus:border-blue-500/50 transition-colors cursor-pointer"
        />
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full"
          tabIndex={-1}
        />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
    </div>
  );
}

function BookingModal({ unit, onClose, onDone }) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('12:00');
  const [members, setMembers] = useState([]);
  const [memberId, setMemberId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/members').then((d) => setMembers(d.members || [])).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/bookings', {
        unitId: unit.id,
        memberId: memberId || undefined,
        title: title || `Booking — ${unit.code}`,
        startAt: `${date}T${startTime}:00`,
        endAt: `${date}T${endTime}:00`,
      });
      onDone();
    } catch (err) {
      setError(err.message || 'Booking failed');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Book ${unit.code}`} onClose={onClose}>
      <form onSubmit={submit}>
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
        )}
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Booking — ${unit.code}`} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" className="input [color-scheme:dark]" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Member (optional)">
            <select className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">— Select —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time">
            <input type="time" className="input [color-scheme:dark]" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </Field>
          <Field label="End time">
            <input type="time" className="input [color-scheme:dark]" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Booking…' : 'Confirm Booking'}</button>
        </div>
      </form>
    </Modal>
  );
}

function BookingCard({ unit, index, duration, onBook, isFav, onToggleFav }) {
  const [imgIdx, setImgIdx] = useState(0);
  const images = [IMAGES[index % IMAGES.length], IMAGES[(index + 2) % IMAGES.length], IMAGES[(index + 4) % IMAGES.length]];
  const price = Number(unit.monthlyPrice || 0) / duration.divisor;
  const amenities = unit.amenities?.length ? unit.amenities : ['Wi-fi'];

  return (
    <div className="rounded-[20px] bg-gradient-to-b from-[#161626] via-[#12121e] to-[#0e0e18] border border-white/[0.09] overflow-hidden hover:border-blue-400/50 hover:shadow-[0_12px_56px_rgba(59,130,246,0.28),0_0_0_1px_rgba(59,130,246,0.15)] hover:-translate-y-1.5 transition-all duration-300 group animate-fadeUp shadow-[0_4px_24px_rgba(0,0,0,0.4)]" style={{ animationDelay: `${(index % 6) * 0.07}s` }}>
      <div className="relative h-44 overflow-hidden">
        <img
          src={images[imgIdx]}
          alt={unit.code}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 contrast-[1.05] saturate-[1.1]"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.08] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <span className={`absolute top-3 left-3 px-3 py-1 rounded-full text-[12px] font-semibold ${unit.isAvailable ? 'bg-[#bfdbfe] text-[#1e3a8a] animate-glowPulse' : 'bg-slate-700/80 text-slate-300'}`}>
          {unit.isAvailable ? 'Available' : 'Booked'}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFav(unit.id); }}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur flex items-center justify-center hover:bg-black/70 hover:scale-110 transition-all duration-200 active:scale-95"
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isFav ? '#f472b6' : 'none'} stroke={isFav ? '#f472b6' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isFav ? 'drop-shadow-[0_0_6px_rgba(244,114,182,0.8)]' : ''}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setImgIdx(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === imgIdx ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'}`}
            />
          ))}
        </div>
      </div>

      <div className="p-4">
        <h3 className="text-white text-[16px] font-semibold truncate drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{unit.code} — {TYPE_LABELS[unit.type] || unit.type}</h3>
        {unit.buildingName && <p className="text-[12px] text-slate-400 mt-0.5">📍 {unit.buildingName}</p>}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[12px] text-white">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            x{unit.capacity || 1}
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-white/[0.07] text-[12px] text-white font-semibold">{TYPE_LABELS[unit.type] || unit.type}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-[12px] ${unit.status === 'vacant' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {unit.status}
          </span>
        </div>
        <p className="flex items-center gap-2 text-[12.5px] text-white mt-2.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          {amenities.join(', ')}
        </p>
        <div className="flex items-end justify-between mt-3.5">
          <div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Start from</p>
            <p className="text-gradient text-[20px] font-extrabold">{money(price)}<span className="text-[12px] font-normal text-slate-400">{duration.suffix}</span></p>
          </div>
          <button
            onClick={() => onBook(unit)}
            disabled={!unit.isAvailable}
            className={`btn-shine px-5 py-2 rounded-xl text-[13.5px] font-semibold whitespace-nowrap border transition-all duration-200 active:scale-95 ${unit.isAvailable ? 'border-blue-400/60 text-blue-200 bg-blue-500/10 shadow-[0_0_16px_rgba(59,130,246,0.35)] hover:bg-blue-500 hover:text-white hover:shadow-[0_0_28px_rgba(59,130,246,0.65)]' : 'border-white/10 text-slate-500 bg-white/[0.03] cursor-not-allowed'}`}
          >
            Book now
          </button>
        </div>
      </div>
    </div>
  );
}

function MapView({ units, onBook }) {
  const [selected, setSelected] = useState(null);
  const positions = units.map((u, i) => ({
    left: `${12 + ((i * 37) % 76)}%`,
    top: `${15 + ((i * 53) % 70)}%`,
  }));

  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] bg-[#0d0d1a] h-[560px] animate-fadeUp">
      <div className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: `
            linear-gradient(rgba(59,130,246,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(59,130,246,0.06) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}
      />
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-0 right-0 h-[3px] bg-blue-500/10 rotate-[8deg]" />
        <div className="absolute top-2/3 left-0 right-0 h-[2px] bg-blue-500/10 -rotate-[12deg]" />
        <div className="absolute left-1/3 top-0 bottom-0 w-[3px] bg-blue-500/10 rotate-[4deg]" />
        <div className="absolute left-2/3 top-0 bottom-0 w-[2px] bg-blue-500/10 -rotate-[6deg]" />
      </div>

      {units.map((u, i) => {
        const isSel = selected === u.id;
        return (
          <button
            key={u.id || i}
            onClick={() => setSelected(isSel ? null : u.id)}
            className="absolute -translate-x-1/2 -translate-y-1/2 group"
            style={{ left: positions[i].left, top: positions[i].top }}
          >
            <span className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-200 group-hover:scale-125 ${isSel ? 'bg-blue-500 border-blue-300 shadow-[0_0_24px_rgba(59,130,246,0.8)] scale-125' : u.isAvailable ? 'bg-[#1a1a2e] border-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.4)]' : 'bg-[#1a1a2e] border-slate-600/60'}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </span>
            {isSel && (
              <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[#1a1a2e] border border-blue-500/30 rounded-xl px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-10 animate-fadeUp">
                <span className="block text-white text-[13px] font-semibold">{u.code}</span>
                <span className="block text-white text-[12px] mt-0.5">{money(u.monthlyPrice)}/mo · {u.isAvailable ? 'Available' : 'Booked'}</span>
                {u.isAvailable && (
                  <span
                    onClick={(e) => { e.stopPropagation(); onBook(u); }}
                    className="mt-2 inline-block px-4 py-1.5 rounded-lg text-[12.5px] font-semibold bg-blue-500 text-white hover:bg-blue-400 transition-colors cursor-pointer"
                  >
                    Book now
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}

      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur rounded-xl px-4 py-2.5 text-[12.5px] text-white border border-white/10">
        📍 {units.length} workspaces nearby
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [wsType, setWsType] = useState('Co-working space');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [bookingUnit, setBookingUnit] = useState(null);
  const [bookedMsg, setBookedMsg] = useState('');
  const [view, setView] = useState('grid');
  const [sortBy, setSortBy] = useState('featured');
  const [durationIdx, setDurationIdx] = useState(1);
  const [budgetIdx, setBudgetIdx] = useState(null);
  const [freebies, setFreebies] = useState([]);
  const [favorites, setFavorites] = useState(new Set());
  const [showFavsOnly, setShowFavsOnly] = useState(false);
  const [availOnly, setAvailOnly] = useState(false);

  const duration = DURATIONS[durationIdx];

  const loadUnits = () => {
    setLoading(true);
    setError('');
    const q = fromDate && toDate ? `?from=${fromDate}&to=${toDate}` : '';
    api.get(`/spaces/units${q}`)
      .then((d) => {
        const list = d.units || d || [];
        setUnits(list);
        setFavorites(new Set(list.filter((u) => u.isFavorite).map((u) => u.id)));
      })
      .catch((e) => { setError(e.message); setUnits([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUnits(); }, [fromDate, toDate]);

  function toggleFav(id) {
    api.post(`/spaces/units/${id}/favorite`)
      .then((d) => {
        setFavorites((prev) => {
          const next = new Set(prev);
          if (d.isFavorite) next.add(id); else next.delete(id);
          return next;
        });
      })
      .catch((e) => setError(e.message));
  }

  function toggleFreebie(fb) {
    setFreebies((prev) => prev.includes(fb) ? prev.filter((x) => x !== fb) : [...prev, fb]);
  }

  const activeType = WORKSPACE_TYPES.find((t) => t.label === wsType);
  let filtered = units.filter((u) => {
    if (search && !((u.code || '') + ' ' + (u.type || '') + ' ' + (u.buildingName || '')).toLowerCase().includes(search.toLowerCase())) return false;
    if (activeType && !activeType.types.includes(u.type)) return false;
    if (showFavsOnly && !favorites.has(u.id)) return false;
    if (availOnly && !u.isAvailable) return false;
    if (budgetIdx !== null) {
      const b = BUDGETS[budgetIdx];
      const p = Number(u.monthlyPrice || 0);
      if (b.min && p < b.min) return false;
      if (b.max && p > b.max) return false;
    }
    if (freebies.length) {
      const am = (u.amenities || []).map((a) => a.toLowerCase());
      if (!freebies.every((fb) => am.includes(fb.toLowerCase()))) return false;
    }
    return true;
  });

  const priceFor = (u) => Number(u.monthlyPrice || 0) / duration.divisor;
  if (sortBy === 'price-low') filtered = [...filtered].sort((a, b) => priceFor(a) - priceFor(b));
  else if (sortBy === 'price-high') filtered = [...filtered].sort((a, b) => priceFor(b) - priceFor(a));
  else if (sortBy === 'name') filtered = [...filtered].sort((a, b) => (a.code || '').localeCompare(b.code || ''));

  const availableCount = useMemo(() => units.filter((u) => u.isAvailable).length, [units]);

  function handleBooked() {
    setBookingUnit(null);
    setBookedMsg('Booking confirmed! 🎉');
    setTimeout(() => setBookedMsg(''), 4000);
    loadUnits();
  }

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-gradient text-[24px] font-extrabold tracking-tight">Available co-workspace</h1>
          <p className="text-[12.5px] text-slate-400 mt-1 font-medium">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/12 border border-emerald-500/25 text-emerald-300 text-[11.5px] font-bold mr-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {availableCount} available
            </span>
            {fromDate === toDate ? `on ${formatDateDisplay(fromDate)}` : `${formatDateDisplay(fromDate)} → ${formatDateDisplay(toDate)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-white/10 overflow-hidden glass">
            {[['grid', 'Grid'], ['map', 'Map']].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-2 text-xs font-semibold transition-all duration-200 ${view === v ? 'bg-gradient-to-b from-blue-500/40 to-blue-600/25 text-blue-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>{l}</button>
            ))}
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="glass rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-blue-400/50 font-medium">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-[#1a1a2e]">{o.label}</option>)}
          </select>
        </div>
      </div>

      {bookedMsg && (
        <div className="mb-4 bg-gradient-to-r from-green-500/15 to-emerald-500/10 border border-green-500/30 text-green-300 text-sm font-medium rounded-xl px-4 py-3 animate-fadeUp shadow-[0_0_24px_rgba(34,197,94,0.15)]">
          {bookedMsg}
        </div>
      )}
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="flex gap-6">
        <div className="w-[248px] shrink-0">
          <div className="glass rounded-[20px] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
          <div className="relative mb-5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" className="absolute left-3.5 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspace"
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl pl-10 pr-4 py-2.5 text-[13.5px] text-white placeholder-slate-500 outline-none focus:border-blue-500/60 focus:shadow-[0_0_16px_rgba(59,130,246,0.2)] transition-all"
            />
          </div>

          <FilterSection title="Availability" defaultOpen>
            <DateField label="From" value={fromDate} onChange={setFromDate} />
            <DateField label="To" value={toDate} onChange={setToDate} />
            <label className="flex items-center gap-2 text-[13px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={availOnly} onChange={(e) => setAvailOnly(e.target.checked)} className="accent-blue-500" />
              Available only
            </label>
          </FilterSection>

          <FilterSection title="Workspace" defaultOpen>
            <div className="space-y-3">
              {WORKSPACE_TYPES.map((t) => (
                <label key={t.label} className="flex items-center gap-3 cursor-pointer group">
                  <span className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center transition-all duration-200 ${wsType === t.label ? 'border-blue-500' : 'border-slate-600 group-hover:border-slate-400'}`}>
                    {wsType === t.label && <span className="w-[10px] h-[10px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />}
                  </span>
                  <input type="radio" name="wsType" checked={wsType === t.label} onChange={() => setWsType(t.label)} className="hidden" />
                  <span className="text-[13.5px] font-medium text-white">{t.label}</span>
                </label>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="Duration">
            <div className="grid grid-cols-2 gap-2">
              {DURATIONS.map((d, i) => (
                <button key={d.label} onClick={() => setDurationIdx(i)}
                  className={`px-3 py-2 rounded-xl text-[13px] font-medium border transition-all ${durationIdx === i ? 'border-blue-400/60 bg-blue-500/20 text-blue-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Prices adjust to the selected billing period.</p>
          </FilterSection>

          <FilterSection title="Budget">
            <div className="space-y-2">
              {BUDGETS.map((b, i) => (
                <button key={b.label} onClick={() => setBudgetIdx(budgetIdx === i ? null : i)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-[13px] border transition-all ${budgetIdx === i ? 'border-blue-400/60 bg-blue-500/20 text-blue-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
                  {b.label} <span className="text-[11px] opacity-70">/mo</span>
                </button>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="Freebies">
            <div className="flex flex-wrap gap-2">
              {FREEBIES.map((fb) => (
                <button key={fb} onClick={() => toggleFreebie(fb)}
                  className={`px-3 py-1.5 rounded-full text-[12.5px] border transition-all ${freebies.includes(fb) ? 'border-blue-400/60 bg-blue-500/20 text-blue-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
                  {fb}
                </button>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="Favorites">
            <label className="flex items-center gap-2 text-[13px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={showFavsOnly} onChange={(e) => setShowFavsOnly(e.target.checked)} className="accent-pink-500" />
              Show favorites only ({favorites.size})
            </label>
          </FilterSection>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {loading ? <Spinner /> : view === 'map' ? (
            <MapView units={filtered} onBook={setBookingUnit} />
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <p className="text-5xl mb-4">🏢</p>
              <p className="text-lg font-medium text-slate-300">No workspaces match</p>
              <p className="text-sm mt-1">Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filtered.map((u, i) => (
                <BookingCard key={u.id} unit={u} index={i} duration={duration} onBook={setBookingUnit} isFav={favorites.has(u.id)} onToggleFav={toggleFav} />
              ))}
            </div>
          )}
        </div>
      </div>

      {bookingUnit && <BookingModal unit={bookingUnit} onClose={() => setBookingUnit(null)} onDone={handleBooked} />}
    </div>
  );
}
