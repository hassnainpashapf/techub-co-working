// Phase 46 Track 10: Finance Currency Dashboard Widget.
// INTEGRATION NOTE (coordinator): apps/web/app/(app)/finance/page.js me:
//   import CurrencyWidget from './_components/CurrencyWidget';
//   ... finance dashboard ke stats ke neeche <CurrencyWidget /> render karein.
// Sirf ceo/admin/finance/super_admin ko dikhe (finance page pehle se role-guarded hai).
'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { StatCard, DataTable, Badge, Spinner, ErrorBanner } from '../../../../components/ui';

const fmt = (n, cur = '') => `${cur ? cur + ' ' : ''}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function CurrencyWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/currency-dashboard/overview')
      .then((r) => setData(r))
      .catch((e) => setErr(e?.message || 'Load nahi ho saka'));
  }, []);

  if (err) return <ErrorBanner message={err} />;
  if (!data) return <div className="flex justify-center py-8"><Spinner /></div>;

  const { baseCurrency, migrated, totals, exposure, rates, staleRates } = data;
  const anyPending = Object.values(migrated || {}).some((v) => v === false);

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#141428] to-[#0d0d1a] p-5 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">💱 Currency Overview</h3>
        <Badge tone="blue">{baseCurrency} base</Badge>
      </div>

      {anyPending && (
        <div className="mb-4 rounded-xl bg-amber-500/10 border border-amber-400/30 px-4 py-2 text-sm text-amber-200">
          Kuch currency features abhi migrate ho rahe hain — kuch sections khali dikh sakte hain.
        </div>
      )}

      {staleRates.length > 0 && (
        <div className="mb-4 rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-2 text-sm text-red-200">
          ⚠️ Purane FX rates (7 din se zyada): {staleRates.join(', ')} — rates update karein.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Revenue (MTD)" value={fmt(totals.revenueMtd, baseCurrency)} accent="green" />
        <StatCard label="Expense (MTD)" value={fmt(totals.expenseMtd, baseCurrency)} accent="red" />
        <StatCard label="Outstanding" value={fmt(totals.outstanding, baseCurrency)} accent="amber" />
        <StatCard
          label="FX P&L (MTD)"
          value={`${totals.fxNetMtd >= 0 ? '+' : '−'}${fmt(Math.abs(totals.fxNetMtd), baseCurrency)}`}
          sub={migrated?.fx ? `Gain ${fmt(totals.fxGainMtd)} • Loss ${fmt(totals.fxLossMtd)}` : 'abhi available nahi'}
          accent={totals.fxNetMtd >= 0 ? 'green' : 'red'}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <h4 className="text-sm font-semibold text-slate-200 mb-2">Per-Currency Exposure</h4>
          <DataTable
            columns={['Currency', 'Invoices', `Total`, `Base (${baseCurrency})`]}
            rows={exposure.map((e) => [e.currency, e.invoices, fmt(e.total, e.currency), fmt(e.baseTotal, baseCurrency)])}
            empty="Abhi koi multi-currency data nahi"
          />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-200 mb-2">Latest FX Rates</h4>
          <DataTable
            columns={['Pair', 'Rate', 'Date', 'Status']}
            rows={rates.map((r) => [
              `${r.from} → ${r.to}`,
              r.rate,
              String(r.effectiveDate).slice(0, 10),
              r.stale ? <Badge tone="red">stale</Badge> : <Badge tone="green">fresh</Badge>,
            ])}
            empty="Abhi koi FX rate set nahi"
          />
        </div>
      </div>
    </div>
  );
}
