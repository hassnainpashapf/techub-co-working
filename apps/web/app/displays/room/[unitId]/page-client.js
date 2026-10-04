'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../../../../lib/api';

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtRange(b) {
  return `${fmtTime(b.startAt)} – ${fmtTime(b.endAt)}`;
}

export default function RoomDisplayPage({ params }) {
  const unitId = params.unitId;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(new Date());
  const [showCheckin, setShowCheckin] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/displays/room/${unitId}/schedule`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || 'Could not load schedule.');
      setData(d);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [unitId]);

  useEffect(() => {
    load();
    const refresh = setInterval(load, 60000); // auto-refresh every 60s
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(refresh); clearInterval(clock); };
  }, [load]);

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-6">
        <div className="text-center">
          <div className="text-6xl mb-4">🚫</div>
          <p className="text-slate-300 text-lg">{error}</p>
          <button onClick={load} className="mt-6 rounded-xl bg-violet-600 hover:bg-violet-500 px-6 py-3 text-white font-semibold">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a14]">
        <div className="animate-pulse text-slate-400 text-xl">Loading room display…</div>
      </div>
    );
  }

  const { unit, tenant, occupied, current, next, schedule } = data;
  const clockStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white flex flex-col"
         style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #1b1b3a 0%, #0a0a14 60%)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-8 md:px-12 py-6 border-b border-white/10">
        <div>
          <div className="text-sm text-slate-400 uppercase tracking-widest">{tenant?.name}</div>
          <h1 className="text-4xl md:text-5xl font-extrabold mt-1">{unit.code}</h1>
          <div className="text-slate-400 text-sm mt-1">Capacity {unit.capacity} · Meeting Room</div>
        </div>
        <div className="text-right">
          <div className="text-4xl md:text-5xl font-bold tabular-nums">{clockStr}</div>
          <div className="text-slate-400 text-sm mt-1">{dateStr}</div>
        </div>
      </header>

      {/* Status hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 py-10 text-center">
        <div className={`rounded-3xl px-12 py-4 text-2xl md:text-3xl font-extrabold tracking-widest uppercase border ${
          occupied
            ? 'border-red-400/40 bg-red-500/15 text-red-300 shadow-[0_0_60px_-10px_rgba(248,113,113,0.5)]'
            : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_60px_-10px_rgba(52,211,153,0.5)]'
        }`}>
          {occupied ? '🔴 Occupied' : '🟢 Available'}
        </div>

        {occupied && current ? (
          <div className="mt-8 max-w-2xl">
            <div className="text-3xl md:text-4xl font-bold">{current.title}</div>
            <div className="text-slate-300 text-xl mt-3 tabular-nums">{fmtRange(current)}</div>
            {current.memberFirstName && (
              <div className="text-slate-400 text-lg mt-2">Booked by {current.memberFirstName}</div>
            )}
            <div className="text-slate-500 text-sm mt-2">Ends at {fmtTime(current.endAt)}</div>
          </div>
        ) : (
          <div className="mt-8">
            <div className="text-2xl md:text-3xl font-semibold text-slate-200">This room is free right now</div>
            {next ? (
              <div className="text-slate-400 text-lg mt-3">
                Next: <span className="text-white font-semibold">{next.title}</span> at{' '}
                <span className="tabular-nums">{fmtTime(next.startAt)}</span>
              </div>
            ) : (
              <div className="text-slate-500 text-lg mt-3">No more bookings today</div>
            )}
          </div>
        )}

        {/* Check-in — links to the existing staff QR check-in scanner */}
        <button
          onClick={() => setShowCheckin(true)}
          className="mt-10 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 px-10 py-4 text-xl font-bold shadow-[0_0_40px_-8px_rgba(124,58,237,0.6)] transition-all"
        >
          ✅ Check in
        </button>
      </main>

      {/* Today's timeline */}
      <footer className="px-8 md:px-12 pb-8">
        <div className="text-sm text-slate-400 uppercase tracking-widest mb-3">Today's schedule</div>
        {schedule.length === 0 ? (
          <div className="text-slate-500 text-sm">No bookings scheduled for today.</div>
        ) : (
          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
            {schedule.map((b) => {
              const isNow = current && current.id === b.id;
              const isPast = new Date(b.endAt) <= now;
              return (
                <div key={b.id} className={`flex items-center gap-4 rounded-xl border px-4 py-3 ${
                  isNow ? 'border-red-400/40 bg-red-500/10'
                  : isPast ? 'border-white/5 bg-white/[0.02] opacity-50'
                  : 'border-white/10 bg-white/[0.03]'
                }`}>
                  <div className="text-sm font-semibold tabular-nums text-slate-300 w-36 shrink-0">{fmtRange(b)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{b.title}</div>
                    {b.memberFirstName && <div className="text-xs text-slate-400">{b.memberFirstName}</div>}
                  </div>
                  {isNow && <span className="text-xs font-bold text-red-300 uppercase tracking-wider">Now</span>}
                </div>
              );
            })}
          </div>
        )}
      </footer>

      {/* Check-in modal */}
      {showCheckin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => setShowCheckin(false)}>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#141422] p-8 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl mb-4">📱</div>
            <h2 className="text-2xl font-bold mb-2">Check in</h2>
            <p className="text-slate-400 text-sm mb-6">
              {current && current.memberFirstName
                ? `${current.memberFirstName}, show your member QR code to the reception scanner to check in.`
                : 'Show your member QR code to the reception scanner to check in.'}
            </p>
            <a
              href="/attendance/scan"
              className="block rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 px-6 py-3.5 font-bold text-white"
            >
              Open QR Scanner (staff)
            </a>
            <button onClick={() => setShowCheckin(false)} className="mt-4 text-sm text-slate-400 hover:text-white">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

