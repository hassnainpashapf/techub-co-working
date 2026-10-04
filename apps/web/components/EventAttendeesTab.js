'use client';

/**
 * Phase 40 Track 6: EventAttendeesTab — "Attendees" tab component.
 *
 * INTEGRATION (coordinator): apps/web/app/(app)/events/page.js ke event
 * detail view me tab lagao:
 *
 *   import EventAttendeesTab from '@/components/EventAttendeesTab';
 *   // tabs list me add:
 *   { id: 'attendees', label: 'Attendees' }
 *   // content:
 *   {activeTab === 'attendees' && <EventAttendeesTab eventId={selectedEvent.id} api={api} />}
 *
 * `api` prop = events page me use hone wala api client (axios/fetch wrapper).
 * Roles: staff-only tab (page khud staff-gated hai).
 */
import { useEffect, useState } from 'react';

export default function EventAttendeesTab({ eventId, api }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      try {
        setErr('');
        const r = await api.get(`/api/events/${eventId}/attendees`);
        setData(r.data || r);
      } catch (e) {
        setErr(e?.response?.data?.error || 'load failed');
      }
    })();
  }, [eventId]);

  if (err) return <div className="text-red-400 text-sm p-4">{err}</div>;
  if (!data) return <div className="text-gray-500 text-sm p-4">Loading…</div>;

  const pct = data.going > 0 ? Math.round((data.checkedIn / data.going) * 100) : 0;

  return (
    <div className="space-y-3 p-1">
      {/* RSVP vs actual stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'RSVP Going', value: data.going },
          { label: 'Interested', value: data.interested },
          { label: 'Checked-in', value: data.checkedIn },
          { label: 'No-show', value: data.noShowCount },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-gray-100/60 border border-gray-200/60 p-4">
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Check-in progress bar */}
      <div className="rounded-xl bg-gray-100/60 border border-gray-200/60 p-4">
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>Check-in rate (vs RSVP going)</span>
          <span className="text-gray-900 font-semibold">{pct}%</span>
        </div>
        <div className="h-3 rounded-full bg-slate-700/60 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>

      {/* Checked-in list */}
      <div className="rounded-xl bg-gray-100/60 border border-gray-200/60 p-4">
        <h3 className="text-gray-900 font-semibold mb-3">Checked-in ({data.checkins.length})</h3>
        {data.checkins.length === 0 ? (
          <p className="text-slate-500 text-sm">Abhi koi check-in nahi hua.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-2">
            {data.checkins.map((c) => (
              <div key={c.memberId} className="flex justify-between text-sm">
                <span className="text-gray-800">{c.name}</span>
                <span className="text-slate-500 text-xs">
                  {new Date(c.checkedInAt).toLocaleString()} · {c.method}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* No-shows */}
      {data.noShows.length > 0 && (
        <div className="rounded-xl bg-red-900/20 border border-red-200 p-4">
          <h3 className="text-red-700 font-semibold mb-3">No-show ({data.noShows.length})</h3>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {data.noShows.map((m) => (
              <div key={m.id} className="text-sm text-red-700/80">{m.name}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
