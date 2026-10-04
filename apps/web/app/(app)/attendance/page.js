'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import {
  PageHeader,
  DataTable,
  Badge,
  Field,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';

const LEAVE_TONE = { pending: 'amber', approved: 'green', rejected: 'red' };
const PRIVILEGED = ['ceo', 'admin', 'operations_manager', 'manager'];

export default function AttendancePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null); // {checkedIn, checkInTime, ...}
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [records, setRecords] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [leaveForm, setLeaveForm] = useState({ from: '', to: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);

  const isPrivileged = PRIVILEGED.includes(user?.role);

  const loadStatus = async () => {
    try {
      const d = await api.get('/attendance/status');
      setStatus(d.status || d);
    } catch (e) {
      setError(e.message);
    }
  };

  const loadRecords = async (d) => {
    try {
      const res = await api.get(`/attendance?date=${d}`);
      setRecords(res.records || res || []);
    } catch (e) {
      setError(e.message);
    }
  };

  const loadLeaves = async () => {
    try {
      const res = await api.get('/attendance/leaves');
      setLeaves(res.leaves || res || []);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadStatus();
      await loadLeaves();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadRecords(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function checkIn() {
    setBusy(true);
    setError('');
    try {
      await api.post('/attendance/check-in');
      await loadStatus();
      await loadRecords(date);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    setBusy(true);
    setError('');
    try {
      await api.post('/attendance/check-out');
      await loadStatus();
      await loadRecords(date);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyLeave(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/attendance/leaves', leaveForm);
      setLeaveForm({ from: '', to: '', reason: '' });
      await loadLeaves();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function decideLeave(id, action) {
    try {
      await api.post(`/attendance/leaves/${id}/${action}`);
      await loadLeaves();
    } catch (e) {
      setError(e.message);
    }
  }

  const checkedIn = status?.checkedIn === true || !!status?.checkInTime;

  if (loading) return <Spinner />;

  const myLeaves = leaves.filter((l) => !isPrivileged || l.userId === user?.id || l.mine);
  const pendingLeaves = leaves.filter((l) => String(l.status).toLowerCase() === 'pending');

  return (
    <div>
      <PageHeader title="Attendance" sub={`Today: ${new Date().toLocaleDateString()}`} />
      <ErrorBanner message={error} onRetry={() => window.location.reload()} />

      {/* Check in/out */}
      <div className="card mb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">My attendance</h2>
            <p className="text-sm text-gray-500">
              Status: {checkedIn ? (
                <span className="font-medium text-green-600">Checked in{status?.checkInTime ? ` at ${String(status.checkInTime).slice(11, 16)}` : ''}</span>
              ) : (
                <span className="font-medium text-gray-500">Not checked in</span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={checkIn} disabled={busy || checkedIn}>
              {busy && !checkedIn ? 'Working…' : 'Check in'}
            </button>
            <button className="btn-secondary" onClick={checkOut} disabled={busy || !checkedIn}>
              {busy && checkedIn ? 'Working…' : 'Check out'}
            </button>
          </div>
        </div>
      </div>

      {/* Records */}
      <div className="card mb-3">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-gray-900">Attendance records</h2>
          <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <DataTable
          columns={[
            { key: 'user', label: 'Staff', render: (r) => r.userName || r.user?.name || r.name || '—' },
            { key: 'in', label: 'Check in', render: (r) => (r.checkInTime ? String(r.checkInTime).slice(11, 16) : '—') },
            { key: 'out', label: 'Check out', render: (r) => (r.checkOutTime ? String(r.checkOutTime).slice(11, 16) : '—') },
            {
              key: 'hours',
              label: 'Hours',
              render: (r) => {
                if (r.checkInTime && r.checkOutTime) {
                  const h = (new Date(r.checkOutTime) - new Date(r.checkInTime)) / 3600000;
                  return `${h.toFixed(1)}h`;
                }
                return '—';
              },
            },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.checkInTime ? 'green' : 'slate'}>{r.checkInTime ? 'Present' : 'Absent'}</Badge> },
          ]}
          rows={records}
          empty={{ title: 'No records for this date' }}
        />
      </div>

      {/* Leaves */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-3">Apply for leave</h2>
          <form onSubmit={applyLeave}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><input type="date" className="input" value={leaveForm.from} onChange={(e) => setLeaveForm({ ...leaveForm, from: e.target.value })} required /></Field>
              <Field label="To"><input type="date" className="input" value={leaveForm.to} onChange={(e) => setLeaveForm({ ...leaveForm, to: e.target.value })} required /></Field>
            </div>
            <Field label="Reason"><textarea className="input" rows="3" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} required placeholder="Reason for leave" /></Field>
            <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit request'}</button>
          </form>
          <h3 className="font-semibold text-gray-900 mt-3 mb-2">My leaves</h3>
          <DataTable
            columns={[
              { key: 'from', label: 'From', render: (r) => (r.from ? String(r.from).slice(0, 10) : '—') },
              { key: 'to', label: 'To', render: (r) => (r.to ? String(r.to).slice(0, 10) : '—') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={LEAVE_TONE[r.status] || 'slate'}>{r.status || '—'}</Badge> },
            ]}
            rows={myLeaves.slice(0, 5)}
            empty={{ title: 'No leave requests' }}
          />
        </div>

        {isPrivileged && (
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-3">Pending leave requests ({pendingLeaves.length})</h2>
            <DataTable
              columns={[
                { key: 'user', label: 'Staff', render: (r) => r.userName || r.user?.name || '—' },
                { key: 'from', label: 'From', render: (r) => (r.from ? String(r.from).slice(0, 10) : '—') },
                { key: 'to', label: 'To', render: (r) => (r.to ? String(r.to).slice(0, 10) : '—') },
                { key: 'reason', label: 'Reason', render: (r) => r.reason || '—' },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (r) => (
                    <div className="flex gap-2">
                      <button className="btn-primary btn-sm" onClick={() => decideLeave(r.id, 'approve')}>Approve</button>
                      <button className="btn-danger btn-sm" onClick={() => decideLeave(r.id, 'reject')}>Reject</button>
                    </div>
                  ),
                },
              ]}
              rows={pendingLeaves}
              empty={{ title: 'No pending requests' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
