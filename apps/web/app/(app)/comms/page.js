'use client';

// Phase 49 Track 10/10: Comms Analytics Dashboard — channel breakdown,
// delivery stats, top members, quick links.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const CHANNEL_LABELS = {
  internal: '💬 Internal', email: '📧 Email', sms: '📱 SMS',
  whatsapp: '🟢 WhatsApp', voice: '📞 Calls', note: '📝 Notes',
};

function ChannelBars({ data }) {
  if (!data || !data.length) return <EmptyState title="Abhi koi messages nahi" />;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.channel}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="font-medium">{CHANNEL_LABELS[d.channel] || d.channel}</span>
            <span className="text-gray-500">{d.count}</span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-[#0f766e] to-teal-600" style={{ width: `${Math.round((d.count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtResponse(min) {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}

export default function CommsDashboardPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const r = await api.get('/api/comms-dashboard/stats');
      setStats(r.stats || {});
    } catch (e) {
      setError(e.message || 'Load nahi hua');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="p-5"><Spinner /></div>;

  const s = stats || {};
  const cards = [
    { label: 'Messages (30d)', value: s.totalMessages ?? '—', icon: '💬' },
    { label: 'Delivery Rate', value: s.deliveryRate != null ? `${s.deliveryRate}%` : '—', icon: '📨' },
    { label: 'Avg Response', value: fmtResponse(s.avgResponseMin), icon: '⏱️' },
    { label: 'Unresolved Inbox', value: s.unresolvedInbox ?? '—', icon: '📥' },
  ];

  return (
    <div className="p-6 space-y-3">
      <PageHeader title="📡 Communication Hub" subtitle="Tamam channels ki analytics ek jagah" />

      {error && <ErrorBanner message={error} />}

      {s.missing && s.missing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Kuch sections abhi pending hain: {s.missing.join(', ')}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} />
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="font-semibold mb-3">Channel Breakdown (30 din)</h3>
          <ChannelBars data={s.byChannel} />
          {s.failedCount > 0 && (
            <div className="mt-3 text-sm text-red-700">⚠️ {s.failedCount} messages fail hue</div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="font-semibold mb-3">Top Active Members</h3>
          {!s.topMembers || !s.topMembers.length ? (
            <EmptyState title="Abhi koi activity nahi" />
          ) : (
            <div className="space-y-2">
              {s.topMembers.map((m) => (
                <div key={m.memberId} className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{m.name}</div>
                    {m.email && <div className="text-xs text-slate-500 truncate">{m.email}</div>}
                  </div>
                  <Badge tone="blue">{m.count} msgs</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <h3 className="font-semibold mb-3">Quick Links</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/comms/inbox', label: '📥 Team Inbox', desc: 'Conversations + assign' },
            { href: '/comms/sms', label: '📱 SMS Campaigns', desc: 'Bulk SMS bhejein' },
            { href: '/comms/templates', label: '📝 Templates', desc: 'Cross-channel templates' },
            { href: '/members', label: '👥 Members', desc: 'Comms timeline per member' },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="rounded-xl border border-gray-200 bg-gray-50 p-4 hover:border-[#0f766e]/40 hover:bg-[#0f766e]/5 transition-colors">
              <div className="font-medium">{l.label}</div>
              <div className="text-xs text-slate-500 mt-1">{l.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
