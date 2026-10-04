'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';
import SavedViews from '../../../components/SavedViews';

const STATUS_TONE = { confirmed: 'green', pending: 'amber', cancelled: 'red' };

function BookingForm({ initial, rooms, members, onSave, saving, error }) {
  const [form, setForm] = useState({
    unitId: initial?.unitId || '',
    memberId: initial?.memberId || '',
    title: initial?.title || '',
    startTime: initial?.startTime ? String(initial.startTime).slice(0, 16) : '',
    endTime: initial?.endTime ? String(initial.endTime).slice(0, 16) : '',
  });
  const [rules, setRules] = useState(null);
  useEffect(() => {
    api.get('/booking-rules').then((d) => setRules(d.settings)).catch(() => {});
  }, []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...form, memberId: form.memberId || undefined });
      }}
    >
      {error && <ErrorBanner message={error} />}
      <Field label="Meeting room">
        <select className="input" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} required>
          <option value="">Select a room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.code} — {(r.type || '').replace(/_/g, ' ')}</option>
          ))}
        </select>
      </Field>
      <Field label="Member (optional)">
        <select className="input" value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Team standup" /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Starts"><input type="datetime-local" className="input" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required /></Field>
        <Field label="Ends"><input type="datetime-local" className="input" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required /></Field>
      </div>
      {rules && (
        <p className="text-xs text-gray-500 mb-3">
          ℹ️ Max {rules.bookingMaxHours}h per booking · {rules.bookingBufferMinutes} min gap between bookings · book up to {rules.bookingAdvanceDays} days ahead · {rules.bookingMinNoticeMinutes} min notice required.
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Book room'}</button>
    </form>
  );
}

export default function BookingsPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'receptionist', 'member');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bookings, setBookings] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [members, setMembers] = useState([]);
  const [roomFilter, setRoomFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const [b, s, m] = await Promise.all([
        api.get('/bookings'),
        api.get('/spaces/units?type=meeting_room').catch(() => ({ units: [] })),
        api.get('/members').catch(() => ({ members: [] })),
      ]);
      setBookings(b.bookings || b || []);
      const units = s.units || s || [];
      setRooms(units.filter((u) => (u.type || '').includes('meeting')));
      setMembers(m.members || m || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      const matchRoom = roomFilter === 'all' || b.unitId === roomFilter;
      const bDate = b.startTime ? String(b.startTime).slice(0, 10) : '';
      const matchDate = !dateFilter || bDate === dateFilter;
      return matchRoom && matchDate;
    });
  }, [bookings, roomFilter, dateFilter]);

  async function handleSave(payload) {
    setSaving(true);
    setFormError('');
    try {
      await api.post('/bookings', payload);
      setModalOpen(false);
      await refresh();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(id) {
    if (!window.confirm('Cancel this booking?')) return;
    try {
      await api.post(`/bookings/${id}/cancel`);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  if (allowed === null) return <Spinner />;
  if (allowed === false) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Bookings"
        sub="Meeting room reservations"
        actions={
          <>
            <select className="input !w-auto !py-2 text-[13px]" value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
              <option value="all">All rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.code}</option>
              ))}
            </select>
            <input type="date" className="input !w-auto !py-2 text-[13px]" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            {dateFilter && <button className="btn-ghost btn-sm" onClick={() => setDateFilter('')}>Clear</button>}
            <SavedViews
              page="bookings"
              currentFilters={{ roomFilter, dateFilter }}
              onApply={(f) => {
                if (typeof f.roomFilter === 'string') setRoomFilter(f.roomFilter);
                if (typeof f.dateFilter === 'string') setDateFilter(f.dateFilter);
              }}
            />
            <button data-tour="new-booking" className="btn-primary" onClick={() => { setFormError(''); setModalOpen(true); }}>+ New booking</button>
          </>
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />

      <div className="card">
        <DataTable
          columns={[
            { key: 'title', label: 'Title', render: (r) => <span className="font-medium text-gray-900">{r.title || '—'}</span> },
            { key: 'room', label: 'Room', render: (r) => r.roomName || r.unitCode || r.unit?.code || '—' },
            { key: 'member', label: 'Member', render: (r) => r.memberName || r.member?.name || '—' },
            {
              key: 'when',
              label: 'When',
              render: (r) =>
                `${r.startTime ? String(r.startTime).slice(0, 16).replace('T', ' ') : '—'} → ${r.endTime ? String(r.endTime).slice(11, 16) : ''}`,
            },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) => (
                String(r.status).toLowerCase() !== 'cancelled' ? (
                  <button className="btn-danger btn-sm" onClick={() => handleCancel(r.id)}>Cancel</button>
                ) : null
              ),
            },
          ]}
          rows={filtered}
          empty={{ title: 'No bookings', hint: 'Book a meeting room to get started.' }}
        />
      </div>

      {modalOpen && (
        <Modal title="New booking" onClose={() => setModalOpen(false)}>
          <BookingForm rooms={rooms} members={members} onSave={handleSave} saving={saving} error={formError} />
        </Modal>
      )}
    </div>
  );
}
