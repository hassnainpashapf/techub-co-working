'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  Field,
  Spinner,
  ErrorBanner,
  EmptyState,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';
import { useAuth } from '../../../../context/AuthContext';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS_TONE = { active: 'green', paused: 'amber', cancelled: 'red' };

function RecurringForm({ units, members, isMember, onSave, saving, error }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    memberId: '',
    unitId: '',
    title: '',
    dayOfWeek: '1',
    startTime: '09:00',
    endTime: '10:00',
    startDate: today,
    endDate: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const payload = {
      unitId: form.unitId,
      title: form.title,
      dayOfWeek: Number(form.dayOfWeek),
      startTime: form.startTime,
      endTime: form.endTime,
      startDate: form.startDate,
      endDate: form.endDate || null,
    };
    if (!isMember) payload.memberId = form.memberId || null;
    onSave(payload);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {!isMember && (
        <Field label="Member">
          <select className="input" value={form.memberId} onChange={set('memberId')}>
            <option value="">— No member —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Unit">
        <select className="input" value={form.unitId} onChange={set('unitId')} required>
          <option value="">Select unit…</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>{u.code} ({u.type})</option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input className="input" value={form.title} onChange={set('title')} required placeholder="e.g. Weekly team standup" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Weekday">
          <select className="input" value={form.dayOfWeek} onChange={set('dayOfWeek')}>
            {WEEKDAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </Field>
        <div />
        <Field label="Start time">
          <input type="time" className="input" value={form.startTime} onChange={set('startTime')} required />
        </Field>
        <Field label="End time">
          <input type="time" className="input" value={form.endTime} onChange={set('endTime')} required />
        </Field>
        <Field label="Start date">
          <input type="date" className="input" value={form.startDate} onChange={set('startDate')} required min={today} />
        </Field>
        <Field label="End date (optional)">
          <input type="date" className="input" value={form.endDate} onChange={set('endDate')} min={form.startDate} />
        </Field>
      </div>
      <p className="text-xs text-gray-500">Bookings for the next 8 weeks will be created automatically. Conflicting slots are skipped.</p>
      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? 'Creating…' : 'Create recurring booking'}
      </button>
    </form>
  );
}

export default function RecurringBookingsPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'operations_manager', 'manager', 'receptionist', 'member');
  const { user } = useAuth();
  const isMember = user?.role === 'member';
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionId, setActionId] = useState(null);

  const refresh = async () => {
    setError('');
    try {
      const [r, u, m] = await Promise.all([
        api.get('/recurring-bookings'),
        api.get('/spaces/units').catch(() => ({ units: [] })),
        isMember ? { members: [] } : api.get('/members').catch(() => ({ members: [] })),
      ]);
      setItems(r.recurringBookings || []);
      setUnits(u.units || u || []);
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

  if (!allowed) return <AccessDenied />;

  const filtered = statusFilter === 'all' ? items : items.filter((r) => r.status === statusFilter);

  async function handleSave(payload) {
    setSaving(true);
    setFormError('');
    try {
      const res = await api.post('/recurring-bookings', payload);
      setModalOpen(false);
      await refresh();
      if (res.skipped > 0) alert(`${res.generated} bookings created, ${res.skipped} slots skipped (past or conflicting).`);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function doAction(id, action) {
    if (action === 'cancel' && !confirm('Cancel this recurring booking? Future generated bookings will be deleted.')) return;
    setActionId(id + action);
    try {
      if (action === 'cancel') await api.del(`/recurring-bookings/${id}`);
      else await api.patch(`/recurring-bookings/${id}`, { status: action === 'pause' ? 'paused' : 'active' });
      await refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setActionId(null);
    }
  }

  const columns = ['Title', 'Member', 'Unit', 'Repeats', 'Time', 'Period', 'Bookings', 'Status', 'Actions'];

  const rows = filtered.map((r) => [
    <span key="t" className="font-medium text-gray-900">{r.title}</span>,
    r.member?.name || <span key="m" className="text-slate-500">—</span>,
    r.unit?.code || <span key="u" className="text-slate-500">—</span>,
    <span key="w">Every {r.weekdayLabel || WEEKDAYS[r.dayOfWeek]}</span>,
    <span key="ti" className="text-gray-600">{r.startTime}–{r.endTime}</span>,
    <span key="p" className="text-gray-500 text-xs">
      {String(r.startDate).slice(0, 10)} → {r.endDate ? String(r.endDate).slice(0, 10) : 'ongoing'}
    </span>,
    <span key="g">{(r.generatedIds || []).length}</span>,
    <Badge key="s" tone={STATUS_TONE[r.status] || 'slate'}>{r.status}</Badge>,
    <div key="a" className="flex gap-2">
      {r.status === 'active' && (
        <button className="btn btn-sm btn-ghost" disabled={actionId} onClick={() => doAction(r.id, 'pause')}>Pause</button>
      )}
      {r.status === 'paused' && (
        <button className="btn btn-sm btn-ghost" disabled={actionId} onClick={() => doAction(r.id, 'resume')}>Resume</button>
      )}
      {r.status !== 'cancelled' && (
        <button className="btn btn-sm btn-danger" disabled={actionId} onClick={() => doAction(r.id, 'cancel')}>Cancel</button>
      )}
    </div>,
  ]);

  return (
    <div>
      <PageHeader
        title="Recurring Bookings"
        sub="Weekly repeat rules that auto-create bookings"
        actions={
          <button className="btn-primary" onClick={() => { setFormError(''); setModalOpen(true); }}>
            + New recurring
          </button>
        }
      />
      {error && <ErrorBanner message={error} onRetry={refresh} />}
      <div className="flex gap-2 mb-4">
        {['all', 'active', 'paused', 'cancelled'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title="No recurring bookings" hint="Create one to auto-generate weekly bookings." />
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}
      {modalOpen && (
        <Modal title="New recurring booking" onClose={() => setModalOpen(false)}>
          <RecurringForm units={units} members={members} isMember={isMember} onSave={handleSave} saving={saving} error={formError} />
        </Modal>
      )}
    </div>
  );
}
