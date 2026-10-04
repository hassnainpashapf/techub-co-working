'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import {
  PageHeader,
  DataTable,
  Badge,
  Spinner,
  ErrorBanner,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const STATUS_TONE = { pending: 'amber', approved: 'green', rejected: 'red' };
const STAFF = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'operations_manager'];

export default function BookingRequestsPage() {
  const { allowed, checking } = useRequireRoles(STAFF);
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(null);
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get(`/public/requests?status=${filter}`);
      setRequests(d.requests || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter]);

  const act = async (id, action) => {
    if (action === 'reject' && !window.confirm('Reject this booking request?')) return;
    setActing(id + action);
    setNotice('');
    setError('');
    try {
      const d = await api.post(`/public/requests/${id}/${action}`);
      if (action === 'approve') {
        setNotice(`Approved — booking created${d.member ? `, member: ${d.member.name}` : ''}. Confirmation email sent.`);
      } else {
        setNotice('Request rejected.');
      }
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setActing(null);
    }
  };

  if (checking) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const columns = [
    { key: 'name', label: 'Name', render: (r) => (
      <div><div className="font-medium text-gray-900">{r.name}</div><div className="text-xs text-gray-500">{r.email} · {r.phone}</div></div>
    )},
    { key: 'unit', label: 'Space', render: (r) => <span className="text-gray-800">{r.unit?.code} <span className="text-slate-500">({r.unit?.type})</span></span> },
    { key: 'when', label: 'When', render: (r) => (
      <div className="text-xs text-gray-600">{new Date(r.date).toLocaleDateString()}<br />{r.startTime} – {r.endTime}</div>
    )},
    { key: 'notes', label: 'Notes', render: (r) => <span className="text-xs text-gray-500 max-w-[200px] block truncate">{r.notes || '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status}</Badge> },
    { key: 'actions', label: '', render: (r) => r.status === 'pending' ? (
      <div className="flex gap-2">
        <button
          onClick={() => act(r.id, 'approve')}
          disabled={!!acting}
          className="rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold px-3 py-1.5 hover:bg-emerald-600/30 disabled:opacity-50"
        >
          {acting === r.id + 'approve' ? '…' : 'Approve'}
        </button>
        <button
          onClick={() => act(r.id, 'reject')}
          disabled={!!acting}
          className="rounded-lg bg-red-600/20 border border-red-500/40 text-red-300 text-xs font-semibold px-3 py-1.5 hover:bg-red-600/30 disabled:opacity-50"
        >
          {acting === r.id + 'reject' ? '…' : 'Reject'}
        </button>
      </div>
    ) : null },
  ];

  return (
    <div>
      <PageHeader
        title="Booking Requests"
        sub="Public requests from the booking page — approve to create a real booking"
        actions={
          <div className="flex gap-2">
            {['pending', 'approved', 'rejected'].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize border ${
                  filter === s
                    ? 'bg-teal-700/30 border-teal-600/50 text-violet-200'
                    : 'border-gray-200 text-gray-500 hover:text-gray-900'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        }
      />
      {notice && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{notice}</div>}
      {error && <ErrorBanner message={error} />}
      {loading ? <Spinner /> : <DataTable columns={columns} rows={requests} rowKey="id" emptyText={`No ${filter} requests.`} />}
    </div>
  );
}
