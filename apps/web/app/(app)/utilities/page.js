'use client';

// Phase 51 Track 10/10: Utilities Dashboard — StatCards, consumption chart, alerts, quick links.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const TYPE_LABEL = { electricity: '⚡ Bijli', water: '💧 Pani', gas: '🔥 Gas', internet: '🌐 Internet' };
const TYPE_COLOR = { electricity: '#38bdf8', water: '#818cf8', gas: '#fbbf24', internet: '#2dd4bf' };

function Bars({ items }) {
  if (!items || !items.length) return <EmptyState title="Consumption data nahi" />;
  const max = Math.max(...items.map((i) => i.consumption), 1);
  return (
    <div className="space-y-3">
      {items.map((t) => (
        <div key={t.type}>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium">{TYPE_LABEL[t.type] || t.type}</span>
            <span className="text-gray-600">{t.consumption.toLocaleString()} units <span className="text-slate-500">({t.meters} meters)</span></span>
          </div>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round((t.consumption / max) * 100)}%`, background: TYPE_COLOR[t.type] || '#38bdf8' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function UtilitiesDashboardPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const d = await api.get('/api/utilities-dashboard/stats');
      setStats(d || {});
    } catch (e) {
      setError(e.message || 'Load nahi hua');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="p-6"><Spinner /></div>;

  const s = stats || {};
  const gs = s.greenScore || null;

  return (
    <div className="p-6 space-y-3">
      <PageHeader title="🔌 Utilities Dashboard" sub="Meters, consumption, cost aur sustainability" actions={
        <button onClick={load} className="btn-secondary">↻ Refresh</button>
      } />
      {error && <ErrorBanner message={error} />}

      {s.missing && s.missing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Utility module ke kuch models abhi merge nahi hue ({s.missing.join(', ')}). Wo sections khali dikhen ge.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard label="Utility cost (30d)" value={s.cost30d != null ? `Rs ${Number(s.cost30d).toLocaleString()}` : '—'} accent="blue" />
        <StatCard label="Active meters" value={s.activeMeters ?? '—'} accent="violet" />
        <StatCard label="Unbilled meters" value={s.unbilled ? s.unbilled.meters : '—'} accent="amber" />
        <StatCard label="Active alerts" value={s.activeAlertCount ?? '—'} accent="red" />
        <StatCard label="🌱 Green score" value={gs ? `${gs.score}/100` : '—'} accent="green" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold mb-3">📊 Consumption (30 din)</h3>
          <Bars items={s.byType30d} />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold mb-3">🌱 Sustainability</h3>
          {!gs ? (
            <EmptyState title="Green score ke liye data nahi" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-5xl font-bold text-green-300">{gs.score}</div>
                <div className="text-sm text-gray-500">/ 100<br />{gs.note}</div>
              </div>
              <div className="text-sm text-gray-600">⚡ {gs.kwh30d.toLocaleString()} kWh (30d)</div>
              <div className="text-sm text-gray-600">🏭 ~{gs.co2kg30d.toLocaleString()} kg CO₂ (30d)</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold mb-3">🚨 Active Alerts ({s.activeAlertCount || 0})</h3>
          {!(s.activeAlerts || []).length ? (
            <EmptyState title="Koi active alert nahi" />
          ) : (
            <div className="space-y-2">
              {s.activeAlerts.map((a) => (
                <div key={a.id} className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm">
                  <div className="text-gray-800">{a.message}</div>
                  <div className="text-xs text-slate-500">{new Date(a.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-lg font-semibold mb-3">⚡ Quick Links</h3>
          <div className="space-y-2">
            <Link href="/utilities/meters" className="block rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm hover:bg-gray-100">🔌 Meters & Readings</Link>
            <Link href="/utilities/green" className="block rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm hover:bg-gray-100">🌱 Green Initiatives</Link>
            <Link href="/billing" className="block rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm hover:bg-gray-100">🧾 Billing (utility invoices)</Link>
            <Link href="/portal/usage" className="block rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm hover:bg-gray-100">👤 Member usage (portal)</Link>
          </div>
          {s.unbilled && s.unbilled.meters > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {s.unbilled.meters} meters ka pichhle 30 din ka bill nahi bana — ~{s.unbilled.totalConsumption.toLocaleString()} units unbilled.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
