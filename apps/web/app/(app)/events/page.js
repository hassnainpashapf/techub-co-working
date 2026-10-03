'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';
import EventAttendeesTab from '../../../components/EventAttendeesTab'; // Phase 40 Track 6

const STATUS_TONE = { upcoming: 'blue', ongoing: 'green', completed: 'slate', cancelled: 'red' };

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function EventForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    startsAt: initial?.startsAt ? initial.startsAt.slice(0, 16) : '',
    endsAt: initial?.endsAt ? initial.endsAt.slice(0, 16) : '',
    location: initial?.location || '',
    capacity: initial?.capacity || '',
    imageUrl: initial?.imageUrl || '',
    status: initial?.status || 'upcoming',
  });
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({
        ...f,
        capacity: f.capacity ? Number(f.capacity) : null,
        startsAt: new Date(f.startsAt).toISOString(),
        endsAt: new Date(f.endsAt).toISOString(),
        imageUrl: f.imageUrl || null,
      });
    }}>
      <Field label="Title *"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={200} /></Field>
      <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts *"><input type="datetime-local" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required /></Field>
        <Field label="Ends *"><input type="datetime-local" className="input" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} required /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Capacity"><input type="number" min={1} className="input" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} placeholder="Unlimited" /></Field>
      </div>
      <Field label="Image URL"><input className="input" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} placeholder="https://…" /></Field>
      <Field label="Status">
        <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="upcoming">Upcoming</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save event'}</button>
    </form>
  );
}

export default function EventsPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rsvps, setRsvps] = useState(null);
  const [rsvpEvent, setRsvpEvent] = useState(null);
  const [attendEvent, setAttendEvent] = useState(null); // Phase 40 Track 6: attendees modal

  const load = () => {
    setLoading(true);
    api.get('/events?all=1')
      .then((d) => setEvents(d.events || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  const save = async (data) => {
    setSaving(true);
    try {
      if (editing) await api.patch(`/events/${editing.id}`, data);
      else await api.post('/events', data);
      setShowForm(false); setEditing(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this event? RSVPs will be removed too.')) return;
    try { await api.delete(`/events/${id}`); load(); } catch (e) { setError(e.message); }
  };

  const viewRsvps = async (ev) => {
    setRsvpEvent(ev);
    try {
      const d = await api.get(`/events/${ev.id}/rsvps`);
      setRsvps(d.rsvps || []);
    } catch (e) { setError(e.message); }
  };

  if (roleLoading) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const upcoming = events.filter((e) => e.status === 'upcoming').length;

  return (
    <div>
      <PageHeader title="Community Events" sub="Create events and track member RSVPs" actions={
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New event</button>
      } />
      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load(); }} />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total events" value={events.length} accent="blue" icon="🎉" />
        <StatCard label="Upcoming" value={upcoming} accent="green" icon="📅" />
        <StatCard label="Total RSVPs" value={events.reduce((s, e) => s + (e._count?.rsvps || 0), 0)} accent="purple" icon="✅" />
      </div>
      {loading ? <Spinner /> : events.length === 0 ? (
        <EmptyState title="No events yet" hint="Create your first community event to bring members together." />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {events.map((ev) => (
            <div key={ev.id} className="card-premium p-5">
              {ev.imageUrl && <img src={ev.imageUrl} alt="" className="rounded-xl h-36 w-full object-cover mb-3" />}
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-bold text-white">{ev.title}</h3>
                <Badge tone={STATUS_TONE[ev.status] || 'slate'}>{ev.status}</Badge>
              </div>
              <p className="text-sm text-slate-400 mb-2">📅 {fmtDate(ev.startsAt)} → {fmtDate(ev.endsAt)}</p>
              {ev.location && <p className="text-sm text-slate-400 mb-2">📍 {ev.location}</p>}
              <p className="text-sm text-slate-300 mb-3">✅ {ev.counts?.going || 0} going · 👀 {ev.counts?.interested || 0} interested{ev.capacity ? ` · 🎟️ ${ev.capacity} seats` : ''}</p>
              <div className="flex gap-2">
                <button className="btn-secondary text-sm" onClick={() => viewRsvps(ev)}>RSVPs</button>
                <button className="btn-secondary text-sm" onClick={() => setAttendEvent(ev)}>Attendees</button>
                <button className="btn-secondary text-sm" onClick={() => { setEditing(ev); setShowForm(true); }}>Edit</button>
                <button className="text-sm text-red-300 hover:text-red-200 px-2" onClick={() => remove(ev.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <Modal title={editing ? 'Edit event' : 'New event'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <EventForm initial={editing} onSave={save} saving={saving} />
        </Modal>
      )}
      {rsvpEvent && (
        <Modal title={`RSVPs — ${rsvpEvent.title}`} onClose={() => { setRsvpEvent(null); setRsvps(null); }}>
          {!rsvps ? <Spinner /> : rsvps.length === 0 ? (
            <EmptyState title="No RSVPs yet" hint="Members haven't responded to this event." />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {rsvps.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                  <span className="text-sm text-white">{r.member?.name || '—'}</span>
                  <Badge tone={r.status === 'going' ? 'green' : r.status === 'interested' ? 'blue' : 'slate'}>{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      {attendEvent && (
        <Modal title={`Attendees — ${attendEvent.title}`} onClose={() => setAttendEvent(null)}>
          <EventAttendeesTab eventId={attendEvent.id} />
        </Modal>
      )}
    </div>
  );
}
