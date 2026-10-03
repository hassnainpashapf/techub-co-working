'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Spinner, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_COLORS = {
  confirmed: 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200',
  cancelled: 'bg-red-500/20 border-red-400/40 text-red-200 line-through',
};

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function isoDay(d) { return d.toISOString().slice(0, 10); }

export default function BookingCalendarPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'receptionist', 'operations_manager', 'finance_manager', 'member']);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const range = useMemo(() => {
    const from = startOfMonth(cursor);
    const to = addMonths(from, 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [cursor]);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    api.get(`/bookings?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`)
      .then((d) => setBookings(d.bookings || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [allowed, range]);

  if (!allowed) return <AccessDenied />;

  // Build calendar grid: weeks starting Monday
  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const startDay = (first.getDay() + 6) % 7; // Monday=0
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const arr = [];
    for (let i = 0; i < startDay; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(new Date(first.getFullYear(), first.getMonth(), d));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = {};
    for (const b of bookings) {
      const key = isoDay(new Date(b.startAt));
      (map[key] = map[key] || []).push(b);
    }
    return map;
  }, [bookings]);

  const todayKey = isoDay(new Date());

  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <div>
      <PageHeader
        title="Booking Calendar"
        subtitle="All bookings at a glance"
        action={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => setCursor(addMonths(cursor, -1))}>‹ Prev</button>
            <button className="btn-secondary" onClick={() => setCursor(startOfMonth(new Date()))}>Today</button>
            <button className="btn-secondary" onClick={() => setCursor(addMonths(cursor, 1))}>Next ›</button>
          </div>
        }
      />
      <h2 className="text-xl font-bold text-white mb-4">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h2>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <div className="card-premium p-4">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-slate-400 py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <div key={i} className="min-h-[90px] rounded-lg bg-white/[0.02]" />;
              const key = isoDay(date);
              const dayBookings = byDay[key] || [];
              const isToday = key === todayKey;
              return (
                <div
                  key={i}
                  className={`min-h-[90px] rounded-lg p-1.5 border transition-colors ${isToday ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                >
                  <div className={`text-xs font-semibold mb-1 ${isToday ? 'text-violet-300' : 'text-slate-300'}`}>{date.getDate()}</div>
                  <div className="space-y-1">
                    {dayBookings.slice(0, 3).map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setSelected(b)}
                        className={`w-full text-left text-[11px] px-1.5 py-0.5 rounded border truncate ${STATUS_COLORS[b.status] || STATUS_COLORS.confirmed}`}
                        title={`${b.title} — ${fmtTime(b.startAt)}`}
                      >
                        {fmtTime(b.startAt)} {b.title}
                      </button>
                    ))}
                    {dayBookings.length > 3 && (
                      <div className="text-[11px] text-slate-400 px-1">+{dayBookings.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {selected && (
        <Modal title="Booking Details" onClose={() => setSelected(null)}>
          <div className="space-y-3">
            <div><div className="text-xs text-slate-400">Title</div><div className="text-white font-semibold">{selected.title}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-slate-400">Unit</div><div className="text-white">{selected.unit?.code} ({selected.unit?.type})</div></div>
              <div><div className="text-xs text-slate-400">Member</div><div className="text-white">{selected.member?.name || '—'}</div></div>
              <div><div className="text-xs text-slate-400">Start</div><div className="text-white">{new Date(selected.startAt).toLocaleString()}</div></div>
              <div><div className="text-xs text-slate-400">End</div><div className="text-white">{new Date(selected.endAt).toLocaleString()}</div></div>
            </div>
            <div><div className="text-xs text-slate-400">Status</div><Badge tone={selected.status === 'confirmed' ? 'green' : 'red'}>{selected.status}</Badge></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
