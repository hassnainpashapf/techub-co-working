'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { PageHeader, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

// Same image pool as Discover page
const IMAGES = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1600&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?w=1600&q=80&auto=format&fit=crop',
];

function imgFor(code) {
  let h = 0;
  for (const c of String(code || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return IMAGES[h % IMAGES.length];
}

function fmtDay(s) {
  return new Date(s).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(s) {
  return new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtRange(b) {
  return `${fmtDay(b.startAt)} · ${fmtTime(b.startAt)} – ${fmtTime(b.endAt)}`;
}
function durationHrs(b) {
  const h = (new Date(b.endAt) - new Date(b.startAt)) / 3600e3;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

// Cancel confirm modal (with policy note)
function CancelModal({ booking, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = async () => {
    setBusy(true); setError('');
    try {
      await api.delete(`/portal/bookings/${booking.id}`);
      onDone();
    } catch (err) {
      setError(err.message || 'Cancel failed'); setBusy(false);
    }
  };
  return (
    <Modal title="Cancel booking?" onClose={onClose}>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}
      <p className="text-gray-600 text-sm mb-2">
        <span className="text-gray-900 font-semibold">{booking.unit?.code}</span> — {fmtRange(booking)}
      </p>
      <p className="text-gray-500 text-xs mb-4">
        Policy: bookings can be cancelled any time before they start. The slot is released immediately for other members.
      </p>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Keep booking</button>
        <button className="btn-danger" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Yes, cancel'}</button>
      </div>
    </Modal>
  );
}

// Reschedule modal — date/time picker → PUT /api/portal/bookings/:id
function RescheduleModal({ booking, onClose, onDone }) {
  const d = new Date(booking.startAt);
  const [date, setDate] = useState(d.toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState(d.toTimeString().slice(0, 5));
  const e = new Date(booking.endAt);
  const [endTime, setEndTime] = useState(e.toTimeString().slice(0, 5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true); setError('');
    try {
      const data = await api.put(`/portal/bookings/${booking.id}`, {
        startAt: `${date}T${startTime}:00`,
        endAt: `${date}T${endTime}:00`,
      });
      onDone(data.booking);
    } catch (err) {
      setError(err.message || 'Reschedule failed'); setBusy(false);
    }
  };

  return (
    <Modal title="Reschedule booking" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}
        <p className="text-gray-600 text-sm mb-4">
          <span className="text-gray-900 font-semibold">{booking.unit?.code}</span> · {booking.unit?.type}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <input type="date" className="input [color-scheme:dark]" value={date} onChange={(ev) => setDate(ev.target.value)} required />
          </Field>
          <Field label="Start">
            <input type="time" className="input [color-scheme:dark]" value={startTime} onChange={(ev) => setStartTime(ev.target.value)} required />
          </Field>
          <Field label="End">
            <input type="time" className="input [color-scheme:dark]" value={endTime} onChange={(ev) => setEndTime(ev.target.value)} required />
          </Field>
        </div>
        <p className="text-slate-500 text-xs mt-3">
          Booking rules apply (max duration, advance notice, buffer between bookings). Overlapping slots are rejected.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save new time'}</button>
        </div>
      </form>
    </Modal>
  );
}

function BookingCard({ booking, onCancel, onReschedule, past }) {
  const statusTone = booking.status === 'cancelled' ? 'red' : past ? 'slate' : 'green';
  return (
    <div className="card-premium overflow-hidden">
      <div className="relative h-32 sm:h-36">
        <img src={imgFor(booking.unit?.code)} alt={booking.unit?.code} className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <div className="absolute top-3 right-3">
          <Badge tone={statusTone}>{booking.status}</Badge>
        </div>
        <div className="absolute bottom-3 left-4 right-4">
          <div className="text-gray-900 font-bold text-lg leading-tight">{booking.unit?.code}</div>
          <div className="text-gray-600 text-xs capitalize">{booking.unit?.type?.replace(/_/g, ' ')}</div>
        </div>
      </div>
      <div className="p-4">
        <div className="text-gray-900 font-semibold text-sm mb-1">{booking.title}</div>
        <div className="text-gray-600 text-sm">📅 {fmtRange(booking)}</div>
        <div className="text-gray-500 text-xs mt-1">⏱ Duration: {durationHrs(booking)}</div>
        {!past && booking.status === 'confirmed' && (
          <div className="flex gap-2 mt-4">
            <button className="btn-secondary flex-1 text-sm" onClick={() => onReschedule(booking)}>Reschedule</button>
            <button className="btn-danger flex-1 text-sm" onClick={() => onCancel(booking)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card-premium overflow-hidden animate-pulse">
          <div className="h-32 sm:h-36 bg-slate-700/40" />
          <div className="p-4 space-y-2">
            <div className="h-4 bg-slate-700/40 rounded w-2/3" />
            <div className="h-3 bg-slate-700/40 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PortalBookingsPage() {
  const [tab, setTab] = useState('upcoming');
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [reschedTarget, setReschedTarget] = useState(null);

  const load = () => {
    setLoading(true); setError('');
    api.get(`/portal/bookings?${tab === 'upcoming' ? 'upcoming=1' : 'past=1'}`)
      .then((d) => setBookings(d.bookings || []))
      .catch((err) => setError(err.message || 'Failed to load bookings'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [tab]);

  const afterChange = (updated) => {
    setCancelTarget(null); setReschedTarget(null);
    if (updated) {
      setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } else {
      load();
    }
  };

  const tabs = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-10">
      <PageHeader
        title="My Bookings"
        sub="Your space bookings — cancel or reschedule anytime before they start"
        actions={(
          <Link href="/discover" className="btn-primary">+ Book new</Link>
        )}
      />

      <div className="flex gap-2 mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
              tab === t.key
                ? 'bg-[#0f766e] text-white shadow-[0_0_18px_rgba(37,99,235,0.5)]'
                : 'bg-gray-100/70 text-gray-600 border border-gray-200 hover:border-[#0f766e]/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <SkeletonGrid />
      ) : bookings.length === 0 ? (
        <EmptyState
          title={tab === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'}
          hint={tab === 'upcoming' ? 'Book a space to see it here' : 'Your booking history will appear here'}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bookings.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              past={tab === 'past'}
              onCancel={setCancelTarget}
              onReschedule={setReschedTarget}
            />
          ))}
        </div>
      )}

      {cancelTarget && (
        <CancelModal booking={cancelTarget} onClose={() => setCancelTarget(null)} onDone={() => afterChange(null)} />
      )}
      {reschedTarget && (
        <RescheduleModal booking={reschedTarget} onClose={() => setReschedTarget(null)} onDone={afterChange} />
      )}
    </div>
  );
}
