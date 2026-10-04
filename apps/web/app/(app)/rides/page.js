'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { api } from '../../../lib/api';
import { Modal, Field, Spinner, ErrorBanner } from '../../../components/ui';

function OfferRideModal({ onClose, onAdd }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ from: '', to: 'Techub Gulberg', date: '', time: '08:30', seats: 3, car: '', phone: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!form.from || !form.date || !form.seats) {
      setError('Please fill all required fields');
      return;
    }
    setSaving(true);
    try {
      const d = await api.post('/rides', { ...form, seats: Number(form.seats) });
      onAdd(d.ride);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title="Offer a Ride" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From *">
            <input className="input" value={form.from} onChange={set('from')} placeholder="e.g. DHA Phase 5" required />
          </Field>
          <Field label="To *">
            <input className="input" value={form.to} onChange={set('to')} placeholder="e.g. Techub Gulberg" required />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date *">
            <input type="date" className="input [color-scheme:dark]" value={form.date} onChange={set('date')} required />
          </Field>
          <Field label="Time *">
            <input type="time" className="input [color-scheme:dark]" value={form.time} onChange={set('time')} required />
          </Field>
          <Field label="Seats *">
            <input type="number" min="1" max="8" className="input" value={form.seats} onChange={set('seats')} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Car">
            <input className="input" value={form.car} onChange={set('car')} placeholder="e.g. Honda City" />
          </Field>
          <Field label="Phone">
            <input className="input" value={form.phone} onChange={set('phone')} placeholder="03xx-xxxxxxx" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-shine btn-primary" disabled={saving}>{saving ? 'Posting…' : 'Post Ride'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RideCard({ ride, onRequest, onCancelRequest, onCancelRide, busy }) {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-[#141422] to-[#101019] border border-gray-200 p-5 hover:border-[#0f766e]/40 hover:shadow-[0_8px_48px_rgba(15,118,110,0.22)] hover:-translate-y-1 transition-all duration-300 animate-fadeUp">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-11 h-11 rounded-full bg-gradient-to-br from-[#0f766e] to-teal-600 flex items-center justify-center text-gray-900 font-bold text-[16px] shadow-[0_0_16px_rgba(15,118,110,0.5)]">
          {(ride.driver || '?').charAt(0).toUpperCase()}
        </span>
        <div>
          <p className="text-white text-[15px] font-semibold">{ride.driver}{ride.mine && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-[#0f766e]/20 text-teal-700">YOU</span>}</p>
          <p className="text-slate-500 text-[12.5px]">{ride.car || 'Car not specified'}</p>
        </div>
        <span className={`ml-auto px-3 py-1 rounded-full text-[12px] font-semibold ${ride.seats > 0 ? 'bg-[#bfdbfe] text-[#1e3a8a] animate-glowPulse' : 'bg-slate-700/60 text-gray-500'}`}>
          {ride.seats > 0 ? `${ride.seats} seat${ride.seats !== 1 ? 's' : ''} left` : 'Full'}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-[13.5px] text-gray-800 font-medium">{ride.from}</span>
        <span className="flex-1 border-t border-dashed border-[#0f766e]/30 relative">
          <svg className="absolute -top-[9px] left-1/2 -translate-x-1/2 text-teal-700" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
        </span>
        <span className="text-[13.5px] text-gray-800 font-medium text-right">{ride.to}</span>
      </div>

      <div className="flex items-center gap-4 text-[12.5px] text-gray-500 mb-4 flex-wrap">
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          {ride.date}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {ride.time}
        </span>
        {ride.phone && (
          <span className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            {ride.phone}
          </span>
        )}
      </div>

      {ride.passengers?.length > 0 && (
        <p className="text-[12px] text-slate-500 mb-3">🧍 {ride.passengers.join(', ')}</p>
      )}

      {ride.mine ? (
        <button onClick={() => onCancelRide(ride.id)} disabled={busy}
          className="w-full py-2.5 rounded-xl text-[13.5px] font-semibold bg-red-50 border border-red-500/40 text-red-700 hover:bg-red-500/20 transition-all">
          Cancel Ride
        </button>
      ) : ride.requested ? (
        <button onClick={() => onCancelRequest(ride.id)} disabled={busy}
          className="w-full py-2.5 rounded-xl text-[13.5px] font-semibold bg-green-500/15 border border-green-500/40 text-green-300 hover:bg-green-500/25 transition-all">
          ✓ Seat Requested — Tap to Cancel
        </button>
      ) : (
        <button
          onClick={() => onRequest(ride.id)}
          disabled={ride.seats <= 0 || busy}
          className={`w-full py-2.5 rounded-xl text-[13.5px] font-semibold transition-all duration-200 active:scale-[0.98] ${
            ride.seats > 0
              ? 'btn-shine border border-[#0f766e]/60 text-teal-700 bg-[#0f766e]/10 shadow-[0_0_16px_rgba(15,118,110,0.35)] hover:bg-[#0f766e] hover:text-gray-900'
              : 'bg-gray-100 border border-gray-200 text-gray-500 cursor-not-allowed'
          }`}
        >
          {ride.seats > 0 ? 'Request Seat' : 'Ride Full'}
        </button>
      )}
    </div>
  );
}

export default function RidesPage() {
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get(`/rides${mineOnly ? '?mine=1' : ''}`);
      setRides(d.rides || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [mineOnly]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  async function handleAdd() {
    flash('Your ride has been posted! 🚗');
    load();
  }

  async function handleRequest(id) {
    setBusy(true);
    try {
      await api.post(`/rides/${id}/request`);
      flash('Seat requested! The driver will contact you. 🎉');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelRequest(id) {
    setBusy(true);
    try {
      await api.del(`/rides/${id}/request`);
      flash('Request cancelled.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelRide(id) {
    if (!confirm('Cancel this ride?')) return;
    setBusy(true);
    try {
      await api.del(`/rides/${id}`);
      flash('Ride cancelled.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = rides.filter((r) =>
    !search || (r.from + ' ' + r.to + ' ' + r.driver).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-gray-900 text-[22px] font-bold">Ride Sharing</h1>
          <p className="text-slate-500 text-[13.5px] mt-1">Share rides with fellow members — save fuel, split costs.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMineOnly(!mineOnly)}
            className={`px-4 py-2.5 rounded-xl text-[13.5px] font-semibold border transition-all ${mineOnly ? 'border-[#0f766e]/60 bg-[#0f766e]/20 text-teal-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
            My Rides
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="btn-shine px-5 py-2.5 rounded-xl text-[13.5px] font-semibold bg-[#134e4a] text-white shadow-[0_0_24px_rgba(15,118,110,0.5)] hover:shadow-[0_0_36px_rgba(15,118,110,0.7)] hover:scale-[1.02] transition-all duration-200 active:scale-95"
          >
            + Offer a Ride
          </button>
        </div>
      </div>

      {msg && (
        <div className="mb-4 bg-green-500/10 border border-green-500/30 text-green-300 text-sm rounded-xl px-4 py-3 animate-fadeUp">
          {msg}
        </div>
      )}
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      <div className="relative mb-6 max-w-md">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" className="absolute left-3.5 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by area or driver..."
          className="w-full bg-transparent border border-gray-300 rounded-xl pl-10 pr-4 py-2.5 text-[13.5px] text-gray-800 placeholder-gray-400 outline-none focus:border-[#0f766e]/50 transition-colors"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p className="text-5xl mb-4">🚗</p>
          <p className="text-lg font-medium text-gray-600">No rides found</p>
          <p className="text-sm mt-1">Be the first to offer a ride!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 gap-5">
          {filtered.map((ride) => (
            <RideCard key={ride.id} ride={ride} onRequest={handleRequest} onCancelRequest={handleCancelRequest} onCancelRide={handleCancelRide} busy={busy} />
          ))}
        </div>
      )}

      {showModal && <OfferRideModal onClose={() => setShowModal(false)} onAdd={handleAdd} />}
    </div>
  );
}
