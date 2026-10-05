'use client';

// Staff Mobile Quick Actions — premium touch-first dashboard:
// today's stats, large quick action cards, recent activity feed, push toggle.

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

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Clean inline SVG line icons (stroke style, 24x24)
function ActionIcon({ path, className = '' }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {path}
    </svg>
  );
}

const ACTIONS = [
  {
    label: 'Check-in Desk', desc: 'Member & visitor check-in', path: '/reception/checkin',
    tint: 'bg-teal-50 text-teal-700', ring: 'hover:border-teal-300',
    icon: (<ActionIcon path={<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 12l2 2 4-4" /><path d="M8 2v4M16 2v4" /></>} />),
  },
  {
    label: 'New Booking', desc: 'Reserve a space instantly', path: '/bookings',
    tint: 'bg-blue-50 text-blue-600', ring: 'hover:border-blue-300',
    icon: (<ActionIcon path={<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="9.5" y1="13.5" x2="14.5" y2="13.5" /></>} />),
  },
  {
    label: 'Raise Ticket', desc: 'Report a maintenance issue', path: '/tickets',
    tint: 'bg-amber-50 text-amber-600', ring: 'hover:border-amber-300',
    icon: (<ActionIcon path={<><path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" /><line x1="13" y1="5" x2="13" y2="19" strokeDasharray="2 3" /></>} />),
  },
  {
    label: 'Log Expense', desc: 'Record a new expense', path: '/finance',
    tint: 'bg-green-50 text-green-600', ring: 'hover:border-green-300',
    icon: (<ActionIcon path={<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>} />),
  },
  {
    label: 'Visitor Check-in', desc: 'Manage visitor arrivals', path: '/visitors',
    tint: 'bg-indigo-50 text-indigo-600', ring: 'hover:border-indigo-300',
    icon: (<ActionIcon path={<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /><path d="M17 8l1 1 2-2" /></>} />),
  },
  {
    label: 'Announcements', desc: 'Broadcast to members', path: '/announcements',
    tint: 'bg-rose-50 text-rose-600', ring: 'hover:border-rose-300',
    icon: (<ActionIcon path={<><path d="M3 11l18-8-8 18-2.5-7.5L3 11z" /><path d="M11.5 14.5L21 3" /></>} />),
  },
];

const TINTS = {
  teal: 'bg-teal-50 text-teal-700',
  blue: 'bg-blue-50 text-blue-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  green: 'bg-green-50 text-green-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
};

function ActivityDot() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

export default function MobileQuickActionsPage() {
  const { allowed } = useRequireRoles('receptionist', 'manager', 'admin', 'ceo', 'super_admin');
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
          occupancyLabel: `${dash?.occupancy?.occupied || 0}/${dash?.occupancy?.total || 0} spaces`,
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
    <div className="pb-10 max-w-5xl mx-auto">
      <PageHeader
        title="Mobile Quick Actions"
        sub={`${greeting()}, ${user?.name || 'Staff'} — today's overview and one-tap actions`}
      />

      {error && <ErrorBanner message={error} onRetry={() => window.location.reload()} />}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <div className="animate-fadeUp">
          {/* Today's stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Occupancy"
              value={`${Math.round((stats?.occupancyRate || 0) * 100)}%`}
              sub={stats?.occupancyLabel}
              accent="teal"
            />
            <StatCard
              label="Check-ins Today"
              value={String(stats?.checkins ?? 0)}
              sub="members & visitors"
              accent="blue"
            />
            <StatCard
              label="Open Tickets"
              value={String(stats?.openTickets ?? 0)}
              sub={stats?.urgentTickets ? `${stats.urgentTickets} urgent` : 'no urgent tickets'}
              accent="amber"
            />
            <StatCard
              label="Pending Dues"
              value={fmtMoney(stats?.duesTotal)}
              sub={`${stats?.duesCount || 0} invoices`}
              accent="red"
            />
          </div>

          {/* Quick actions — large touch targets */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-gray-500 uppercase tracking-[0.12em]">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {ACTIONS.map((a) => (
              <Link
                key={a.path + a.label}
                href={a.path}
                className={`card p-5 flex items-center gap-4 min-h-[104px] active:scale-[0.97] hover:-translate-y-0.5 ${a.ring} transition-all duration-200 group`}
              >
                <span className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${a.tint}`}>
                  {a.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-gray-900 font-semibold text-[15px] leading-tight">{a.label}</span>
                  <span className="block text-gray-500 text-[12.5px] mt-1 leading-snug">{a.desc}</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  className="ml-auto text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            ))}
          </div>

          {/* Recent activity */}
          <h2 className="text-[13px] font-bold text-gray-500 uppercase tracking-[0.12em] mb-3">Recent Activity</h2>
          <div className="card p-2 mb-6">
            {activity.length === 0 ? (
              <EmptyState
                title="No recent activity"
                hint="Actions taken across the workspace will appear here."
                icon={(
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                )}
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {activity.slice(0, 10).map((log, i) => (
                  <li key={log.id || i} className="px-3 py-3 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                      <ActivityDot />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800 truncate font-medium">
                        {log.action || log.event || 'Activity'}
                        {log.user?.name ? <span className="text-gray-500 font-normal"> — {log.user.name}</span> : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{fmtTime(log.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Push notifications */}
          <h2 className="text-[13px] font-bold text-gray-500 uppercase tracking-[0.12em] mb-3">Push Notifications</h2>
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <span className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${TINTS.teal}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 font-semibold text-[15px]">Stay in the loop</p>
                <p className="text-gray-500 text-[12.5px] mt-0.5">Get instant alerts for bookings, tickets and announcements.</p>
              </div>
              <PushToggle />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
