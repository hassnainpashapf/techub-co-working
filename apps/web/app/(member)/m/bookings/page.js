'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Spinner, ErrorBanner, Badge, Modal, Field } from '../../../../components/ui';

export default function MemberBookings() {
  const [bookings, setBookings] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ unitId: '', title: '', date: '', startTime: '09:00', endTime: '10:00' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/bookings'), api.get('/spaces/units')])
      .then(([b, u]) => { setBookings(b.bookings || []); setUnits((u.units || []).filter((x) => x.status === 'vacant')); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/bookings', {
        unitId: form.unitId,
        title: form.title,
        startAt: new Date(`${form.date}T${form.startTime}`).toISOString(),
        endAt: new Date(`${form.date}T${form.endTime}`).toISOString(),
      });
      setShowForm(false);
      setForm({ unitId: '', title: '', date: '', startTime: '09:00', endTime: '10:00' });
      load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const cancel = async (id) => {
    if (!confirm('Cancel this booking?')) return;
    try { await api.del(`/bookings/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-gray-900">My Bookings</h1>
        <button className="btn-primary text-sm" onClick={() => setShowForm(true)}>+ New Booking</button>
      </div>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {bookings.map((b) => (
            <div key={b.id} className="card-premium p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900">{b.title}</div>
                <div className="text-xs text-gray-500">{b.unit?.code} · {new Date(b.startAt).toLocaleString()} → {new Date(b.endAt).toLocaleTimeString()}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={b.status === 'confirmed' ? 'green' : 'red'}>{b.status}</Badge>
                {b.status === 'confirmed' && new Date(b.startAt) > new Date() && (
                  <button className="text-xs text-red-300 hover:text-red-200" onClick={() => cancel(b.id)}>Cancel</button>
                )}
              </div>
            </div>
          ))}
          {bookings.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No bookings yet.</p>}
        </div>
      )}
      {showForm && (
        <Modal title="New Booking" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <Field label="Unit">
              <select className="input" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} required>
                <option value="">Select a space…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.code} ({u.type})</option>)}
              </select>
            </Field>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Team meeting" /></Field>
            <Field label="Date"><input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required min={new Date().toISOString().slice(0, 10)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start"><input type="time" className="input" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required /></Field>
              <Field label="End"><input type="time" className="input" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required /></Field>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Booking…' : 'Confirm Booking'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
