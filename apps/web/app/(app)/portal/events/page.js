'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

const STATUS_TONE = { upcoming: 'blue', ongoing: 'green', completed: 'slate', cancelled: 'red' };

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function PortalEventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [myRsvps, setMyRsvps] = useState({});
  const [busy, setBusy] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/events')
      .then((d) => setEvents(d.events || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const rsvp = async (ev, status) => {
    setBusy(ev.id);
    setError('');
    try {
      const d = await api.post(`/events/${ev.id}/rsvp`, { status });
      setMyRsvps((m) => ({ ...m, [ev.id]: status }));
      setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, counts: d.counts } : e)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Community Events" sub="What's happening at Techub" />
      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load(); }} />}
      {events.length === 0 ? (
        <EmptyState title="No events right now" hint="Check back soon — new community events are posted regularly." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 gap-4">
          {events.map((ev) => {
            const mine = myRsvps[ev.id];
            const full = ev.capacity && (ev.counts?.going || 0) >= ev.capacity && mine !== 'going';
            return (
              <div key={ev.id} className="card-premium p-5">
                {ev.imageUrl && <img src={ev.imageUrl} alt="" className="rounded-xl h-36 w-full object-cover mb-3" />}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-bold text-white">{ev.title}</h3>
                  <Badge tone={STATUS_TONE[ev.status] || 'slate'}>{ev.status}</Badge>
                </div>
                {ev.description && <p className="text-sm text-slate-400 mb-2 line-clamp-2">{ev.description}</p>}
                <p className="text-sm text-slate-300 mb-1">📅 {fmtDate(ev.startsAt)}</p>
                {ev.location && <p className="text-sm text-slate-300 mb-2">📍 {ev.location}</p>}
                <p className="text-sm text-slate-400 mb-3">✅ {ev.counts?.going || 0} going{ev.capacity ? ` / ${ev.capacity} seats` : ''}</p>
                {mine && mine !== 'cancelled' ? (
                  <div className="flex items-center gap-2">
                    <Badge tone={mine === 'going' ? 'green' : 'blue'}>You're {mine}</Badge>
                    <button className="text-sm text-slate-400 hover:text-white" disabled={busy === ev.id} onClick={() => rsvp(ev, 'cancelled')}>Cancel RSVP</button>
                  </div>
                ) : full ? (
                  <Badge tone="red">Full</Badge>
                ) : (
                  <div className="flex gap-2">
                    <button className="btn-primary text-sm flex-1" disabled={busy === ev.id} onClick={() => rsvp(ev, 'going')}>Going</button>
                    <button className="btn-secondary text-sm flex-1" disabled={busy === ev.id} onClick={() => rsvp(ev, 'interested')}>Interested</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
