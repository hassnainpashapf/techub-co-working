'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, EmptyState, StatCard, Badge } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function money(n) {
  return 'Rs ' + Number(n || 0).toLocaleString('en-PK');
}

function ProgressBar({ pct }) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const color = p >= 80 ? 'from-green-500 to-emerald-500' : p >= 40 ? 'from-[#8b5cf6] to-cyan-500' : 'from-amber-500 to-orange-500';
  return (
    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
      <div className={`h-full rounded-full bg-gradient-to-r ${color}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export default function EventsDashboardPage() {
  const allowed = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        setLoading(true);
        const [s, u] = await Promise.all([api.get('/api/events-dashboard/stats'), api.get('/api/events-dashboard/upcoming')]);
        setStats(s.data?.stats || {});
        setEvents(u.data?.events || []);
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Dashboard load nahi ho saka');
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Event Organizer Dashboard" subtitle="Ticketing sales aur upcoming events ki progress" />

      {err && <ErrorBanner message={err} />}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Upcoming Events" value={stats?.upcomingEvents ?? '—'} icon="📅" />
        <StatCard title="Tickets Sold (30d)" value={stats?.ticketsSold30d ?? '—'} icon="🎟️" />
        <StatCard title="Ticket Revenue (30d)" value={money(stats?.ticketRevenue30d)} icon="💰" />
        <StatCard title="Avg Fill Rate" value={(stats?.avgFillRate ?? 0) + '%'} icon="📊" />
        <StatCard title="Refunds (30d)" value={stats?.refunds30d ?? '—'} icon="↩️" />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Upcoming Events — Sales Progress</h3>
          <div className="flex gap-2">
            <a href="/events" className="btn btn-secondary btn-sm">+ Create Event</a>
            <a href="/events/scan" className="btn btn-secondary btn-sm">🎫 Scan Tickets</a>
          </div>
        </div>
        {!events.length && <EmptyState title="Koi upcoming event nahi" hint="Events page se naya event banayein" />}
        <div className="space-y-4">
          {events.map((ev) => (
            <a key={ev.id} href="/events" className="block p-4 rounded-xl bg-white/5 hover:bg-white/10 transition border border-white/10">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <div className="font-medium text-white">{ev.title}</div>
                  <div className="text-xs text-slate-400">{fmtDate(ev.startsAt)}{ev.location ? ` • ${ev.location}` : ''}</div>
                </div>
                <Badge tone={ev.status === 'ongoing' ? 'green' : 'blue'}>{ev.status}</Badge>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="flex-1">
                  <ProgressBar pct={ev.fillRate} />
                </div>
                <div className="text-slate-300 whitespace-nowrap text-xs">
                  {ev.sold}{ev.capacity ? ` / ${ev.capacity}` : ''} tickets • {ev.fillRate}% • {money(ev.revenue)}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a href="/events" className="card p-5 hover:border-violet-400/40 transition">
          <div className="text-2xl mb-2">📅</div>
          <div className="font-semibold text-white">Manage Events</div>
          <div className="text-sm text-slate-400">Events banayein, ticket types aur sponsors set karein</div>
        </a>
        <a href="/events/scan" className="card p-5 hover:border-violet-400/40 transition">
          <div className="text-2xl mb-2">🎫</div>
          <div className="font-semibold text-white">Entry Scanning</div>
          <div className="text-sm text-slate-400">Gate par QR tickets validate karein</div>
        </a>
        <a href="/events" className="card p-5 hover:border-violet-400/40 transition">
          <div className="text-2xl mb-2">📢</div>
          <div className="font-semibold text-white">Promote</div>
          <div className="text-sm text-slate-400">Public event page share kar ke zyada tickets bechein</div>
        </a>
      </div>
    </div>
  );
}
