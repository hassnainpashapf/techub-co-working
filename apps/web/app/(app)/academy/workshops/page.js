'use client';

// Phase 53 Track 6/10: Live Workshop Sessions — schedule + bookings.
// Staff tab: workshop CRUD + attendee list (attended mark). Member view: upcoming + my bookings.

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';
import { useAuth } from '../../../../context/AuthContext';

const STAFF = ['ceo', 'admin', 'super_admin', 'manager'];
const STATUS_TONE = { scheduled: 'blue', ongoing: 'green', completed: 'slate', cancelled: 'red' };

function fmtDT(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function WorkshopForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    scheduledAt: initial?.scheduledAt ? initial.scheduledAt.slice(0, 16) : '',
    durationMin: initial?.durationMin ?? 60,
    meetingUrl: initial?.meetingUrl || '',
    capacity: initial?.capacity ?? '',
    instructorId: initial?.instructorId || '',
    courseId: initial?.courseId || '',
    status: initial?.status || 'scheduled',
  });
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({
        ...f,
        scheduledAt: new Date(f.scheduledAt).toISOString(),
        durationMin: Number(f.durationMin) || 60,
        capacity: f.capacity ? Number(f.capacity) : null,
        meetingUrl: f.meetingUrl || null,
        instructorId: f.instructorId || null,
        courseId: f.courseId || null,
      });
    }}>
      <Field label="Title *"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={200} /></Field>
      <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Scheduled at *"><input type="datetime-local" className="input" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} required /></Field>
        <Field label="Duration (min)"><input type="number" min={5} max={1440} className="input" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Capacity"><input type="number" min={1} className="input" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} placeholder="Unlimited" /></Field>
        <Field label="Meeting URL"><input className="input" value={f.meetingUrl} onChange={(e) => setF({ ...f, meetingUrl: e.target.value })} placeholder="https://…" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Instructor ID"><input className="input" value={f.instructorId} onChange={(e) => setF({ ...f, instructorId: e.target.value })} /></Field>
        <Field label="Course ID (optional)"><input className="input" value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })} /></Field>
      </div>
      <Field label="Status">
        <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {['scheduled', 'ongoing', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <button className="btn btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save workshop'}</button>
    </form>
  );
}

export default function WorkshopsPage() {
  const { user } = useAuth();
  const isStaff = STAFF.includes(user?.role);
  const [tab, setTab] = useState('upcoming');
  const [upcoming, setUpcoming] = useState([]);
  const [mine, setMine] = useState([]);
  const [all, setAll] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [detail, setDetail] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      if (isStaff) {
        const [a] = await Promise.all([api.get('/api/workshops')]);
        setAll(a.workshops || []);
      } else {
        const [u, m] = await Promise.all([api.get('/api/workshops/upcoming'), api.get('/api/workshops/my')]);
        setUpcoming(u.workshops || []);
        setMine(m.bookings || []);
      }
    } catch (e) { setError(e.message || 'Load fail'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [user?.role]);

  const save = async (data) => {
    setBusy(true);
    try {
      if (editing) await api.put(`/api/workshops/${editing.id}`, data);
      else await api.post('/api/workshops', data);
      setShowForm(false); setEditing(null); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete workshop?')) return;
    setBusy(true);
    try { await api.delete(`/api/workshops/${id}`); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const book = async (id) => {
    setBusy(true);
    try { await api.post(`/api/workshops/${id}/book`); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const cancel = async (id) => {
    if (!confirm('Booking cancel karein?')) return;
    setBusy(true);
    try { await api.post(`/api/workshops/${id}/cancel`); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const openDetail = async (id) => {
    setBusy(true);
    try {
      const d = await api.get(`/api/workshops/${id}`);
      setDetail(d.workshop);
      const b = await api.get(`/api/workshops/${id}/bookings`);
      setBookings(b.bookings || []);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const markAttend = async (bookingId) => {
    setBusy(true);
    try {
      await api.patch(`/api/workshops/${detail.id}/bookings/${bookingId}/attend`);
      await openDetail(detail.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Live Workshops"
        subtitle="Schedule live sessions, manage seats aur bookings"
        actions={isStaff && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            + New workshop
          </button>
        )}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}

      {!isStaff && (
        <div className="flex gap-2">
          {[['upcoming', 'Upcoming'], ['mine', 'My bookings']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === k ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Member view */}
      {!isStaff && tab === 'upcoming' && (
        <div className="grid md:grid-cols-2 gap-4">
          {(upcoming || []).map((w) => (
            <div key={w.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">{w.title}</h3>
                  <p className="text-sm text-slate-300">{fmtDT(w.scheduledAt)} · {w.durationMin} min</p>
                </div>
                <Badge tone={STATUS_TONE[w.status]}>{w.status}</Badge>
              </div>
              {w.description && <p className="text-sm text-slate-200 mt-2 line-clamp-2">{w.description}</p>}
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-slate-200">
                  {w.seatsLeft === null ? 'Unlimited seats' : `${w.seatsLeft} / ${w.capacity} seats left`}
                </span>
                <div className="flex gap-2">
                  {w.meetingUrl && w.myBooking && (
                    <a href={w.meetingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Join →</a>
                  )}
                  {w.myBooking
                    ? <button className="btn btn-secondary btn-sm" onClick={() => cancel(w.id)} disabled={busy}>Cancel</button>
                    : <button className="btn btn-primary btn-sm" onClick={() => book(w.id)} disabled={busy || w.seatsLeft === 0}>Book seat</button>}
                </div>
              </div>
            </div>
          ))}
          {!upcoming.length && <EmptyState title="No upcoming workshops" />}
        </div>
      )}

      {!isStaff && tab === 'mine' && (
        <div className="grid md:grid-cols-2 gap-4">
          {mine.map((b) => (
            <div key={b.id} className="card flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">{b.workshop?.title}</h3>
                <p className="text-sm text-slate-300">{fmtDT(b.workshop?.scheduledAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={b.status === 'attended' ? 'green' : 'blue'}>{b.status}</Badge>
                {b.status === 'booked' && (
                  <>
                    {b.workshop?.meetingUrl && <a href={b.workshop.meetingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Join →</a>}
                    <button className="btn btn-secondary btn-sm" onClick={() => cancel(b.workshopId)} disabled={busy}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!mine.length && <EmptyState title="No bookings yet" />}
        </div>
      )}

      {/* Staff view */}
      {isStaff && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total workshops" value={all.length} />
            <StatCard title="Scheduled" value={all.filter((w) => w.status === 'scheduled').length} />
            <StatCard title="Ongoing" value={all.filter((w) => w.status === 'ongoing').length} />
            <StatCard title="Total seats booked" value={all.reduce((s, w) => s + (w.bookedSeats || 0), 0)} />
          </div>
          <div className="card overflow-x-auto">
            <table className="table w-full">
              <thead><tr><th>Title</th><th>When</th><th>Seats</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {all.map((w) => (
                  <tr key={w.id}>
                    <td className="font-medium text-white">{w.title}</td>
                    <td className="text-sm text-slate-300">{fmtDT(w.scheduledAt)} · {w.durationMin}m</td>
                    <td className="text-sm text-slate-200">{w.bookedSeats}{w.capacity != null ? `/${w.capacity}` : ''}</td>
                    <td><Badge tone={STATUS_TONE[w.status]}>{w.status}</Badge></td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn btn-secondary btn-sm mr-2" onClick={() => openDetail(w.id)}>Attendees</button>
                      <button className="btn btn-secondary btn-sm mr-2" onClick={() => { setEditing(w); setShowForm(true); }}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(w.id)} disabled={busy}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!all.length && <EmptyState title="No workshops yet" />}
          </div>
        </>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit workshop' : 'New workshop'}>
        <WorkshopForm initial={editing} onSave={save} saving={busy} />
      </Modal>

      <Modal open={!!detail} onClose={() => { setDetail(null); setBookings([]); }} title={detail?.title || 'Attendees'}>
        <div className="space-y-2">
          <p className="text-sm text-slate-300">{detail && fmtDT(detail.scheduledAt)} · {detail?.bookedSeats}{detail?.capacity != null ? `/${detail.capacity}` : ''} booked</p>
          {bookings.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-white">{b.member?.name || b.memberId}</div>
                <div className="text-xs text-slate-300">{b.member?.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={b.status === 'attended' ? 'green' : b.status === 'cancelled' ? 'red' : 'blue'}>{b.status}</Badge>
                {b.status === 'booked' && <button className="btn btn-secondary btn-sm" onClick={() => markAttend(b.id)} disabled={busy}>Mark attended</button>}
              </div>
            </div>
          ))}
          {!bookings.length && <EmptyState title="No bookings yet" />}
        </div>
      </Modal>
    </div>
  );
}
