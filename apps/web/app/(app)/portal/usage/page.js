'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtNum(n, unit) {
  if (n == null) return '—';
  return `${Number(n).toLocaleString()}${unit ? ' ' + unit : ''}`;
}
function fmtMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString()}`;
}

const TYPE_TONE = { electricity: 'amber', water: 'blue', gas: 'violet', internet: 'green' };
const BILL_TONE = { paid: 'green', unpaid: 'amber', partial: 'blue', overdue: 'red' };

function periodLabel(b) {
  if (!b.periodStart || !b.periodEnd) return '—';
  return `${fmtDate(b.periodStart)} → ${fmtDate(b.periodEnd)}`;
}

// Simple SVG bars: monthly total consumption
function TrendBars({ trend }) {
  const max = Math.max(1, ...trend.map((t) => t.total || 0));
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">📊 Mahana Istemaal (pichhle 6 mahine)</h3>
      <div className="flex items-end gap-3 h-40">
        {trend.map((t, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[11px] text-gray-600">{t.total ? Number(t.total).toLocaleString() : ''}</span>
            <div
              className="w-full rounded-t bg-[#0f766e]"
              style={{ height: `${Math.max(4, (t.total / max) * 120)}px` }}
              title={Object.entries(t.byType || {})
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')}
            />
            <span className="text-[11px] text-gray-500">{t.month}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PortalUsagePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const d = await api.get('/my-usage');
        if (live) setData(d);
      } catch (e) {
        if (live) setError(e?.message || 'Usage load nahi ho saka.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const unpaid = (data.bills || []).filter((b) => b.status !== 'paid').reduce((a, b) => a + Number(b.amount || 0), 0);
    const paid = (data.bills || []).filter((b) => b.status === 'paid').reduce((a, b) => a + Number(b.amount || 0), 0);
    return {
      meters: (data.meters || []).length,
      bills: (data.bills || []).length,
      unpaid,
      paid,
    };
  }, [data]);

  if (loading) return <div className="p-6"><Spinner /></div>;

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="⚡ Meri Utility Usage" sub="Meters, readings aur utility bills — sab ek jagah" />

      {error && <ErrorBanner message={error} />}
      {data?.pendingMigration?.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-2">
          Utility module abhi setup ho raha hai — kuch sections jald nazar aayenge.
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Meters" value={stats.meters} icon="🔌" />
          <StatCard title="Utility Bills" value={stats.bills} icon="🧾" />
          <StatCard title="Baqaya" value={fmtMoney(stats.unpaid)} icon="⏳" tone="amber" />
          <StatCard title="Ada Shuda" value={fmtMoney(stats.paid)} icon="✅" tone="green" />
        </div>
      )}

      {/* Meters */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">🔌 Mere Meters</h3>
        {!(data?.meters || []).length ? (
          <EmptyState title="Koi meter nahi" text="Aap ke unit par abhi koi utility meter register nahi hai." />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {(data.meters || []).map((m) => (
              <div key={m.id} className="rounded-xl border border-gray-200 bg-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{m.name}</span>
                  <Badge tone={TYPE_TONE[m.type] || 'slate'}>{m.typeLabel}</Badge>
                </div>
                <div className="text-xs text-gray-500 space-y-1">
                  <div>Unit: <span className="text-gray-800">{m.unitName}</span></div>
                  {m.meterNumber && <div>Meter #: <span className="text-gray-800">{m.meterNumber}</span></div>}
                  <div>
                    Aakhri reading: <span className="text-gray-800 font-semibold">{fmtNum(m.lastReading, m.unit)}</span>
                    <span className="text-slate-500"> · {fmtDate(m.lastReadAt)}</span>
                  </div>
                  {m.lastConsumption != null && (
                    <div>
                      Pichhli reading se istemaal: <span className="text-gray-800">{fmtNum(m.lastConsumption, m.unit)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trend */}
      {(data?.trend || []).length > 0 && <TrendBars trend={data.trend} />}

      {/* Bills */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">🧾 Meri Utility Bills</h3>
        {!(data?.bills || []).length ? (
          <EmptyState title="Koi bill nahi" text="Abhi tak koi utility bill generate nahi hua." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4">Muddat</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Istemaal</th>
                  <th className="py-2 pr-4">Raqam</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.bills || []).map((b) => (
                  <tr key={b.id} className="border-b border-gray-200 text-gray-800">
                    <td className="py-2 pr-4">{periodLabel(b)}</td>
                    <td className="py-2 pr-4">{b.typeLabel || '—'}</td>
                    <td className="py-2 pr-4">{b.consumption != null ? Number(b.consumption).toLocaleString() : '—'}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{fmtMoney(b.amount)}</td>
                    <td className="py-2 pr-4"><Badge tone={BILL_TONE[b.status] || 'slate'}>{b.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
