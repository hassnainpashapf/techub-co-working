'use client';

// Phase 37 Track 10: Staff Mobile Quick Actions.
// Mobile-optimized quick dashboard: aaj ki stats, bade touch quick actions,
// recent activity feed (audit logs), aur web push subscribe toggle.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { PageHeader, StatCard, Spinner, EmptyState, ErrorBanner } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';
import PushToggle from '../settings/notifications/PushToggle';

function fmtMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString()}`;
}

function fmtTime(s) {
  if (!s) return '';
  return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ACTIONS = [
  { label: 'Check-in Desk', icon: '✅', path: '/reception/checkin', desc: 'Member / visitor check-in' },
  { label: 'New Booking', icon: '📅', path: '/bookings', desc: 'Space book karein' },
  { label: 'Raise Ticket', icon: '🎫', path: '/tickets', desc: 'Issue report karein' },
  { label: 'Log Expense', icon: '💸', path: '/finance', desc: 'Kharcha record karein' },
  { label: 'Visitor Check-in', icon: '🧑‍💼', path: '/visitors', desc: 'Visitor manage karein' },
  { label: 'Announcements', icon: '📢', path: '/announcements', desc: 'Elaan bhejein' },
];

export default function MobileQuickActionsPage() {
  const { allowed } = useRequireRoles('receptionist', 'manager', 'admin', 'ceo');
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    if (allowed !== true) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [dash, ticketStats, att, logs] = await Promise.all([
          api.get('/dashboard'),
          api.get('/tickets/stats').catch(() => ({ stats: {} })),
          api.get(`/attendance?date=${today}`).catch(() => ({ records: [] })),
          api.get('/audit-logs?limit=10').catch(() => ({ logs: [] })),
        ]);
        if (cancelled) return;
        setStats({
          occupancyRate: dash?.occupancy?.rate || 0,
          occupancyLabel: `${dash?.occupancy?.occupied || 0}/${dash?.occupancy?.total || 0}`,
          checkins: (att?.records || []).filter((r) => r.checkIn).length,
          openTickets: ticketStats?.stats?.open ?? 0,
          urgentTickets: ticketStats?.stats?.urgent ?? 0,
          duesCount: dash?.dues?.count || 0,
          duesTotal: dash?.dues?.total || 0,
        });
        setActivity(logs?.logs || logs?.data || []);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [allowed]);

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7]">
        <Spinner size="lg" />
      </div>
    );
  }
  if (allowed === false) return <AccessDenied />;

  return (
    <div className="pb-10">
      <PageHeader
        title="📱 Mobile Quick Actions"
        sub={`Assalam-o-Alaikum, ${user?.name || 'Staff'} — aaj ka khulasa aur tez actions`}
      />

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Aaj ki stats */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard
              label="Occupancy"
              value={`${Math.round((stats?.occupancyRate || 0) * 100)}%`}
              sub={stats?.occupancyLabel}
            />
            <StatCard
              label="Aaj Check-ins"
              value={String(stats?.checkins ?? 0)}
              sub="members/visitors"
            />
            <StatCard
              label="Open Tickets"
              value={String(stats?.openTickets ?? 0)}
              sub={stats?.urgentTickets ? `${stats.urgentTickets} urgent` : 'koi urgent nahi'}
            />
            <StatCard
              label="Pending Dues"
              value={fmtMoney(stats?.duesTotal)}
              sub={`${stats?.duesCount || 0} invoices`}
            />
          </div>

          {/* Quick actions — bade touch buttons */}
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {ACTIONS.map((a) => (
              <Link
                key={a.path + a.label}
                href={a.path}
                className="card p-5 flex flex-col items-center justify-center text-center min-h-[120px] active:scale-95 transition-transform hover:border-[#0f766e]/40"
              >
                <span className="text-3xl mb-2">{a.icon}</span>
                <span className="text-gray-900 font-semibold text-sm">{a.label}</span>
                <span className="text-gray-500 text-xs mt-1">{a.desc}</span>
              </Link>
            ))}
          </div>

          {/* Recent activity */}
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Recent Activity</h2>
          <div className="card p-2 mb-3">
            {activity.length === 0 ? (
              <EmptyState title="Koi activity nahi" hint="Abhi tak koi recent activity record nahi hui." />
            ) : (
              <ul className="divide-y divide-gray-200">
                {activity.slice(0, 10).map((log, i) => (
                  <li key={log.id || i} className="px-3 py-2.5 flex items-start gap-3">
                    <span className="text-lg">📝</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800 truncate">
                        {log.action || log.event || 'Activity'}
                        {log.user?.name ? ` — ${log.user.name}` : ''}
                      </p>
                      <p className="text-xs text-slate-500">{fmtTime(log.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Push notifications */}
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Push Notifications</h2>
          <div className="card p-4">
            <PushToggle />
          </div>
        </>
      )}
    </div>
  );
}
