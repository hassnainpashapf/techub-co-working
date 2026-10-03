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

const WEEK_BAR = {
  confirmed: 'bg-emerald-500/70 hover:bg-emerald-500 border-emerald-300/50',
  cancelled: 'bg-red-500/50 hover:bg-red-500/70 border-red-300/40 line-through',
};

const HOUR_START = 8;
const HOUR_END = 22;
const HOUR_PX = 56;

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoDay(d) { return d.toISOString().slice(0, 10); }

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function BookingModal({ booking, onClose }) {
  if (!booking) return null;
  return (
    <Modal title="Booking Details" onClose={onClose}>
      <div className="space-y-3">
        <div><div className="text-xs text-slate-400">Title</div><div className="text-white font-semibold">{booking.title}</div></div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className="text-xs text-slate-400">Unit</div><div className="text-white">{booking.unit?.code} ({booking.unit?.type})</div></div>
          <div><div className="text-xs text-slate-400">Member</div><div className="text-white">{booking.member?.name || '—'}</div></div>
          <div><div className="text-xs text-slate-400">Start</div><div className="text-white">{new Date(booking.startAt).toLocaleString()}</div></div>
          <div><div className="text-xs text-slate-400">End</div><div className="text-white">{new Date(booking.endAt).toLocaleString()}</div></div>
        </div>
        <div><div className="text-xs text-slate-400">Status</div><Badge tone={booking.status === 'confirmed' ? 'green' : 'red'}>{booking.status}</Badge></div>
      </div>
    </Modal>
  );
}

function MonthView({ cursor, bookings, onSelect }) {
  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const startDay = (first.getDay() + 6) % 7;
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

  return (
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
                    onClick={() => onSelect(b)}
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
  );
}

function WeekView({ weekStart, bookings, onSelect }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const todayKey = isoDay(new Date());
  const hours = useMemo(() => Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i), []);

  const byDay = useMemo(() => {
    const map = {};
    for (const b of bookings) {
      const key = isoDay(new Date(b.startAt));
      (map[key] = map[key] || []).push(b);
    }
    return map;
  }, [bookings]);

  // Layout overlapping bookings into lanes
  const layoutDay = (list) => {
    const sorted = [...list].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    const lanes = [];
    return sorted.map((b) => {
      const s = new Date(b.startAt).getTime();
      const e = new Date(b.endAt).getTime();
      let lane = lanes.findIndex((l) => l <= s);
      if (lane === -1) { lanes.push(e); lane = lanes.length - 1; }
      else lanes[lane] = e;
      return { b, lane, laneCount: lanes.length };
    });
  };

  const clampHour = (d) => {
    const h = d.getHours() + d.getMinutes() / 60;
    return Math.max(HOUR_START, Math.min(HOUR_END, h));
  };

  return (
    <div className="card-premium p-4 overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[52px_repeat(7,1fr)] gap-px mb-1">
          <div />
          {days.map((d) => {
            const key = isoDay(d);
            const isToday = key === todayKey;
            return (
              <div key={key} className={`text-center py-2 rounded-lg ${isToday ? 'bg-violet-500/15' : ''}`}>
                <div className="text-[11px] font-semibold text-slate-400">{DAYS[(d.getDay() + 6) % 7]}</div>
                <div className={`text-lg font-bold ${isToday ? 'text-violet-300' : 'text-white'}`}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[52px_repeat(7,1fr)] gap-px relative">
          <div className="relative">
            {hours.map((h) => (
              <div key={h} className="text-[10px] text-slate-500 text-right pr-2" style={{ height: HOUR_PX }}>
                {h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const key = isoDay(d);
            const items = layoutDay(byDay[key] || []);
            const isToday = key === todayKey;
            return (
              <div key={key} className={`relative border-l border-white/5 ${isToday ? 'bg-violet-500/[0.04]' : ''}`} style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h) => (
                  <div key={h} className="border-t border-white/[0.06]" style={{ height: HOUR_PX }} />
                ))}
                {items.map(({ b, lane, laneCount }) => {
                  const top = (clampHour(new Date(b.startAt)) - HOUR_START) * HOUR_PX;
                  const bottom = (clampHour(new Date(b.endAt)) - HOUR_START) * HOUR_PX;
                  const height = Math.max(22, bottom - top);
                  const widthPct = 100 / laneCount;
                  return (
                    <button
                      key={b.id}
                      onClick={() => onSelect(b)}
                      title={`${b.title} — ${fmtTime(b.startAt)} to ${fmtTime(b.endAt)}`}
                      className={`absolute rounded-md border px-1.5 py-0.5 text-left overflow-hidden transition-colors ${WEEK_BAR[b.status] || WEEK_BAR.confirmed}`}
                      style={{ top, height, left: `${lane * widthPct}%`, width: `calc(${widthPct}% - 3px)` }}
                    >
                      <div className="text-[11px] font-semibold text-white truncate">{b.title}</div>
                      <div className="text-[10px] text-white/80 truncate">{fmtTime(b.startAt)}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function BookingCalendarPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'manager', 'receptionist', 'operations_manager', 'finance_manager', 'member']);
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [weekCursor, setWeekCursor] = useState(() => startOfWeek(new Date()));
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const range = useMemo(() => {
    if (view === 'week') {
      const from = weekCursor;
      const to = addDays(weekCursor, 7);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const from = startOfMonth(cursor);
    const to = addMonths(from, 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [view, cursor, weekCursor]);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    api.get(`/bookings?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`)
      .then((d) => setBookings(d.bookings || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [allowed, range]);

  if (!allowed) return <AccessDenied />;

  const title = view === 'week'
    ? `Week of ${weekCursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const nav = (dir) => {
    if (view === 'week') setWeekCursor(addDays(weekCursor, dir * 7));
    else setCursor(addMonths(cursor, dir));
  };
  const goToday = () => {
    if (view === 'week') setWeekCursor(startOfWeek(new Date()));
    else setCursor(startOfMonth(new Date()));
  };

  return (
    <div>
      <PageHeader
        title="Booking Calendar"
        subtitle="All bookings at a glance"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-white/10 overflow-hidden mr-1">
              {['month', 'week'].map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize ${view === v ? 'bg-violet-500/25 text-violet-200' : 'text-slate-400 hover:bg-white/5'}`}>
                  {v}
                </button>
              ))}
            </div>
            <button className="btn-secondary" onClick={() => nav(-1)}>‹ Prev</button>
            <button className="btn-secondary" onClick={goToday}>Today</button>
            <button className="btn-secondary" onClick={() => nav(1)}>Next ›</button>
          </div>
        }
      />
      <h2 className="text-xl font-bold text-white mb-4">{title}</h2>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : view === 'week' ? (
        <WeekView weekStart={weekCursor} bookings={bookings} onSelect={setSelected} />
      ) : (
        <MonthView cursor={cursor} bookings={bookings} onSelect={setSelected} />
      )}
      <BookingModal booking={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
