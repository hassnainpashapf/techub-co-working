'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';
import { PageHeader, StatCard, DataTable, Badge, Spinner, ErrorBanner } from '../../../../components/ui';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

export default function FxGainLossPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'finance_officer');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [l, s] = await Promise.all([
          api.get('/fx-gainloss?limit=100'),
          api.get('/fx-gainloss/summary'),
        ]);
        setRows(l.items || []);
        setSummary({ totalGains: s.totalGains, totalLosses: s.totalLosses, net: s.net });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  const gains = Number(summary?.totalGains || 0);
  const losses = Number(summary?.totalLosses || 0);
  const net = Number(summary?.net ?? gains - losses);

  return (
    <div>
      <PageHeader title="FX Gain / Loss" sub="Foreign-currency payments par rate farq ka hisaab (base currency me)" />
      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Gains" value={money(gains)} accent="green" />
        <StatCard label="Total Losses" value={money(losses)} accent="red" />
        <StatCard label="Net" value={money(net)} sub={net >= 0 ? 'net gain' : 'net loss'} accent={net >= 0 ? 'indigo' : 'amber'} />
      </div>

      <div className="card">
        <DataTable
          columns={[
            { key: 'createdAt', label: 'Date', render: (r) => new Date(r.createdAt).toLocaleDateString() },
            { key: 'invoiceNumber', label: 'Invoice', render: (r) => r.invoiceNumber || '—' },
            { key: 'reason', label: 'Reason', render: (r) => <Badge>{r.reason}</Badge> },
            {
              key: 'amount', label: 'Amount', align: 'right',
              render: (r) => (
                <span className={Number(r.amount) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {Number(r.amount) >= 0 ? '+' : ''}{money(r.amount)}
                </span>
              ),
            },
          ]}
          rows={rows}
          empty={{ title: 'No FX records', hint: 'Cross-currency payments par gain/loss yahan aayega.' }}
        />
      </div>
    </div>
  );
}
