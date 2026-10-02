'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import {
  PageHeader,
  StatCard,
  DataTable,
  Badge,
  Spinner,
  ErrorBanner,
  EmptyState,
} from '../../../components/ui';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

function statusTone(s) {
  s = (s || '').toLowerCase();
  if (['paid'].includes(s)) return 'green';
  if (['pending', 'partial'].includes(s)) return 'amber';
  if (['overdue', 'unpaid'].includes(s)) return 'red';
  return 'slate';
}

function StaffDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/dashboard')
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={() => window.location.reload()} />;

  const occ = data?.occupancy || {};
  const billing = data?.billing || {};
  const tasks = data?.tasks || {};
  const dues = data?.dues || [];
  const invoices = data?.recentInvoices || data?.invoices || [];

  return (
    <div>
      <PageHeader title="Dashboard" sub="Overview of your coworking space" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Occupancy"
          value={`${occ.percent ?? 0}%`}
          sub={`${occ.occupied ?? 0} of ${occ.total ?? 0} units occupied`}
          accent="indigo"
        />
        <StatCard
          label="Pending dues"
          value={money(billing.pendingDues)}
          sub={`${billing.unpaidInvoices ?? 0} unpaid invoices`}
          accent="red"
        />
        <StatCard
          label="Revenue this month"
          value={money(billing.revenueThisMonth)}
          sub={billing.monthLabel || ''}
          accent="green"
        />
        <StatCard
          label="Pending tasks"
          value={tasks.pending ?? 0}
          sub={`${tasks.done ?? 0} completed`}
          accent="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-3">Top pending dues</h2>
          <DataTable
            columns={[
              { key: 'member', label: 'Member', render: (r) => r.memberName || r.member?.name || '—' },
              { key: 'amount', label: 'Amount', render: (r) => money(r.amount || r.balance) },
              { key: 'due', label: 'Due date', render: (r) => r.dueDate ? String(r.dueDate).slice(0, 10) : '—' },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={statusTone(r.status)}>{r.status || 'pending'}</Badge>,
              },
            ]}
            rows={dues.slice(0, 5)}
            empty={{ title: 'No pending dues', hint: 'All invoices are settled.' }}
          />
        </div>
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-3">Recent invoices</h2>
          <DataTable
            columns={[
              { key: 'no', label: 'Invoice', render: (r) => r.number || r.id?.slice(0, 8) || '—' },
              { key: 'member', label: 'Member', render: (r) => r.memberName || r.member?.name || '—' },
              { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge tone={statusTone(r.status)}>{r.status || 'pending'}</Badge>,
              },
            ]}
            rows={invoices.slice(0, 5)}
            empty={{ title: 'No invoices yet', hint: 'Generate invoices from the Billing page.' }}
          />
        </div>
      </div>
    </div>
  );
}

function MemberDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/dashboard/member')
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={() => window.location.reload()} />;

  const dues = data?.dues || data?.invoices || [];
  const bookings = data?.bookings || [];
  const contract = data?.contract;

  return (
    <div>
      <PageHeader title="My Dashboard" sub="Your membership at a glance" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="My pending dues"
          value={money(data?.pendingDues ?? dues.reduce((s, r) => s + Number(r.balance || r.amount || 0), 0))}
          sub={`${dues.length} open invoice(s)`}
          accent="red"
        />
        <StatCard
          label="Upcoming bookings"
          value={bookings.length}
          sub="meeting room bookings"
          accent="indigo"
        />
        <StatCard
          label="My space"
          value={contract?.unitCode || contract?.space || '—'}
          sub={contract?.plan || contract?.type || ''}
          accent="green"
        />
      </div>

      {contract && (
        <div className="card mb-4">
          <h2 className="font-semibold text-slate-900 mb-2">My contract</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-xs text-slate-500">Unit</p><p className="font-medium">{contract.unitCode || contract.space || '—'}</p></div>
            <div><p className="text-xs text-slate-500">Plan</p><p className="font-medium">{contract.plan || '—'}</p></div>
            <div><p className="text-xs text-slate-500">Start</p><p className="font-medium">{contract.startDate ? String(contract.startDate).slice(0, 10) : '—'}</p></div>
            <div><p className="text-xs text-slate-500">End</p><p className="font-medium">{contract.endDate ? String(contract.endDate).slice(0, 10) : '—'}</p></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-3">My dues</h2>
          <DataTable
            columns={[
              { key: 'no', label: 'Invoice', render: (r) => r.number || r.id?.slice(0, 8) || '—' },
              { key: 'amount', label: 'Amount', render: (r) => money(r.balance ?? r.amount) },
              { key: 'due', label: 'Due date', render: (r) => (r.dueDate ? String(r.dueDate).slice(0, 10) : '—') },
              { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status || 'pending'}</Badge> },
            ]}
            rows={dues.slice(0, 5)}
            empty={{ title: 'No dues', hint: 'You are all paid up.' }}
          />
        </div>
        <div className="card">
          <h2 className="font-semibold text-slate-900 mb-3">My bookings</h2>
          <DataTable
            columns={[
              { key: 'title', label: 'Title', render: (r) => r.title || r.room || '—' },
              { key: 'room', label: 'Room', render: (r) => r.roomName || r.unitCode || '—' },
              {
                key: 'when',
                label: 'When',
                render: (r) =>
                  `${r.startTime ? String(r.startTime).slice(0, 16).replace('T', ' ') : '—'}`,
              },
            ]}
            rows={bookings.slice(0, 5)}
            empty={{ title: 'No bookings', hint: 'Book a meeting room from the Bookings page.' }}
          />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user?.role === 'member') return <MemberDashboard />;
  return <StaffDashboard />;
}
