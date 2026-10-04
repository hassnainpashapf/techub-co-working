'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';

function fmtDate(s) {
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function QuotaBar({ used, included }) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const over = used > included;
  return (
    <div>
      <div className="flex items-end justify-between mb-2">
        <div>
          <div className="text-4xl font-extrabold text-gray-900">{Math.max(0, included - used)}<span className="text-lg text-gray-500"> pages left</span></div>
          <div className="text-sm text-gray-500 mt-1">{used} of {included} pages used this month</div>
        </div>
        {over && <Badge tone="red">Overage</Badge>}
      </div>
      <div className="h-4 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-gradient-to-r from-sky-500 to-[#0f766e]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function PortalPrintingPage() {
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [b, h] = await Promise.all([api.get('/printing/balance'), api.get('/printing/history')]);
      setBalance(b);
      setHistory(h.entries || []);
    } catch (e) {
      setError(e.message || 'Failed to load printing credits');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Printing Credits" subtitle="Your monthly print quota and usage" />
      {error && <ErrorBanner message={error} />}
      {loading ? <Spinner /> : balance && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="card-premium p-5 md:col-span-2">
              <QuotaBar used={balance.used} included={balance.included} />
            </div>
            <StatCard label="Month" value={balance.month} />
          </div>
          {balance.overage > 0 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-200 mb-6">
              You printed {balance.overage} pages over your quota this month — overage is billed automatically.
            </div>
          )}
          <h2 className="text-lg font-bold text-gray-900 mb-3">Print history</h2>
          {history.length === 0 ? (
            <EmptyState title="No print jobs yet" />
          ) : (
            <div className="card-premium overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="p-3">Date</th>
                    <th className="p-3">Pages</th>
                    <th className="p-3">Charge</th>
                    <th className="p-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((j) => (
                    <tr key={j.id} className="border-b border-gray-200/50 hover:bg-gray-100/30">
                      <td className="p-3 text-gray-600">{fmtDate(j.createdAt)}</td>
                      <td className="p-3 text-gray-900 font-semibold">{j.pages}</td>
                      <td className="p-3">{j.cost != null ? <span className="text-amber-300">Rs {Number(j.cost).toLocaleString()}</span> : <span className="text-slate-500">Included</span>}</td>
                      <td className="p-3 text-gray-500">{j.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
