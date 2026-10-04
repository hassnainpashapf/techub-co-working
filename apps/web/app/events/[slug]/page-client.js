'use client';

// Phase 44 Track 1: Public event landing page — "/events/[slug]?tenant=<tenantSlug>".
// No login needed. Track 2 (paid tickets) yahan ticket purchase jodega —
// "Get tickets" button track 3 ke flow par jayega (integration note neeche).
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const API = () => process.env.NEXT_PUBLIC_API_URL || '';

function fmt(d) {
  try {
    return new Date(d).toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return d; }
}

export default function PublicEventPage() {
  const { slug } = useParams();
  const search = useSearchParams();
  const tenantSlug = search.get('tenant') || '';
  const [state, setState] = useState('loading'); // loading | ready | notfound | error
  const [event, setEvent] = useState(null);
  const [tenantName, setTenantName] = useState('');

  useEffect(() => {
    if (!slug || !tenantSlug) { setState('notfound'); return; }
    (async () => {
      try {
        const r = await fetch(`${API()}/api/events/public/${encodeURIComponent(slug)}?tenantSlug=${encodeURIComponent(tenantSlug)}`);
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.event) {
          setEvent(d.event);
          setTenantName(d.tenant?.name || '');
          setEvent((prev) => prev ? { ...prev, ticketTypes: d.ticketTypes || [], sponsors: d.sponsors || [], agenda: d.agenda || { sessions: [], speakers: [] } } : prev);
          setState('ready');
        } else {
          setState(r.status === 503 ? 'error' : 'notfound');
        }
      } catch { setState('error'); }
    })();
  }, [slug, tenantSlug]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-[#0b0b14] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-400" />
      </div>
    );
  }

  if (state !== 'ready' || !event) {
    return (
      <div className="min-h-screen bg-[#0b0b14] flex items-center justify-center px-6">
        <div className="text-center">
          <div className="text-5xl mb-4">🎟️</div>
          <h1 className="text-2xl font-bold text-white mb-2">Event not found</h1>
          <p className="text-slate-400">Ye event link ghalat hai ya event ab public nahi.</p>
        </div>
      </div>
    );
  }

  const spotsLeft = event.capacity != null
    ? Math.max(0, event.capacity - (event._count?.rsvps || 0))
    : null;

  return (
    <div className="min-h-screen bg-[#0b0b14] text-white">
      {/* Cover */}
      <div className="relative h-64 sm:h-80 overflow-hidden">
        {event.imageUrl ? (
          <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-violet-900 via-[#12121f] to-indigo-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b14] via-[#0b0b14]/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 max-w-3xl mx-auto">
          <p className="text-violet-300 text-sm font-medium mb-1">{tenantName}</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{event.title}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Meta cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-slate-400 mb-1">📅 Date & time</p>
            <p className="font-semibold">{fmt(event.startsAt)}</p>
            {event.endsAt && <p className="text-sm text-slate-400">Ends: {fmt(event.endsAt)}</p>}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-slate-400 mb-1">📍 Location</p>
            <p className="font-semibold">{event.location || 'To be announced'}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-slate-400 mb-1">👥 Seats</p>
            <p className="font-semibold">
              {spotsLeft != null ? `${spotsLeft} left` : 'Open event'}
            </p>
            {event._count && <p className="text-sm text-slate-400">{event._count.rsvps} going</p>}
          </div>
        </div>

        {/* About / agenda preview */}
        {event.description && (
          <div className="mb-8">
            <h2 className="text-lg font-bold mb-3">About this event</h2>
            <p className="text-slate-300 whitespace-pre-line leading-relaxed">{event.description}</p>
          </div>
        )}

        {/* Ticket types — Track 2 (paid tickets) yahan list banayega: event.ticketTypes */}
        {event.ticketTypes && event.ticketTypes.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold mb-3">Tickets</h2>
            <div className="space-y-3">
              {event.ticketTypes.map((t) => (
                <div key={t.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-sm text-slate-400">{t.remaining != null ? `${t.remaining} left` : ''}</p>
                  </div>
                  <p className="font-bold text-lg">{t.price === '0' || t.price === '0.00' ? 'Free' : `Rs ${t.price}`}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agenda — sessions + speakers (Track 7) */}
        {event.agenda && (event.agenda.sessions?.length > 0 || event.agenda.speakers?.length > 0) && (
          <div className="mb-8">
            <h2 className="text-lg font-bold mb-3">Agenda</h2>
            {event.agenda.sessions?.length > 0 && (
              <div className="space-y-2 mb-4">
                {event.agenda.sessions.map((s) => (
                  <div key={s.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex justify-between items-start gap-2">
                      <p className="font-semibold text-sm">{s.title}</p>
                      <p className="text-xs text-slate-400 whitespace-nowrap">{fmt(s.startTime)} – {fmt(s.endTime)}</p>
                    </div>
                    {s.speaker && <p className="text-xs text-violet-300 mt-1">🎤 {s.speaker.name}{s.speaker.title ? ` — ${s.speaker.title}` : ''}</p>}
                    {s.location && <p className="text-xs text-slate-400 mt-1">📍 {s.location}</p>}
                  </div>
                ))}
              </div>
            )}
            {event.agenda.speakers?.length > 0 && (
              <div>
                <h3 className="text-sm font-bold mb-2 text-slate-300">Speakers</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {event.agenda.speakers.map((sp) => (
                    <div key={sp.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                      {sp.photoUrl && <img src={sp.photoUrl} alt={sp.name} className="w-12 h-12 rounded-full mx-auto mb-2 object-cover" />}
                      <p className="text-sm font-semibold">{sp.name}</p>
                      {(sp.title || sp.company) && <p className="text-xs text-slate-400">{[sp.title, sp.company].filter(Boolean).join(' @ ')}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sponsors (Track 6) */}
        {event.sponsors && event.sponsors.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold mb-3">Sponsors</h2>
            <div className="flex flex-wrap gap-3">
              {event.sponsors.map((sp) => (
                <div key={sp.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 flex items-center gap-3">
                  {sp.logoUrl && <img src={sp.logoUrl} alt={sp.name} className="h-8 object-contain" />}
                  <div>
                    <p className="text-sm font-semibold">{sp.name}</p>
                    <p className="text-xs text-amber-300 capitalize">{sp.tier}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA — Track 3 ticket purchase flow */}
        <button
          onClick={() => {
            if (event.ticketTypes && event.ticketTypes.length > 0) {
              window.location.href = `/events/${encodeURIComponent(slug)}/tickets?tenant=${encodeURIComponent(tenantSlug)}`;
            } else if (event.externalUrl) {
              window.open(event.externalUrl, '_blank');
            }
          }}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 font-bold text-lg hover:from-violet-500 hover:to-indigo-500 transition shadow-lg shadow-violet-900/40"
        >
          🎟️ Get tickets
        </button>
        <p className="text-center text-xs text-slate-500 mt-4">
          Powered by {tenantName || 'CoworkOS'}
        </p>
      </div>
    </div>
  );
}

