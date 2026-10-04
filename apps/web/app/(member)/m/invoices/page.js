'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Spinner, ErrorBanner, Badge } from '../../../../components/ui';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

export default function MemberInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/billing/invoices')
      .then((d) => setInvoices(d.invoices || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const downloadPdf = (inv) => {
    const token = localStorage.getItem('cw_access');
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    fetch(`${base}/billing/invoices/${inv.id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${inv.number}.pdf`; a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => alert('PDF download failed'));
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-gray-900">My Invoices</h1>
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const balance = Number(inv.amount) - Number(inv.amountPaid || 0);
            return (
              <div key={inv.id} className="card-premium p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-sm text-gray-600">{inv.number}</span>
                  <Badge tone={inv.status === 'paid' ? 'green' : inv.status === 'overdue' ? 'red' : 'amber'}>{inv.status}</Badge>
                </div>
                <div className="text-xs text-gray-500 mb-2">Due: {inv.dueDate?.slice(0, 10)}</div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-lg font-bold text-gray-900">{money(inv.amount)}</span>
                    {balance > 0 && <span className="text-sm text-red-700 ml-2">({money(balance)} due)</span>}
                  </div>
                  <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => downloadPdf(inv)}>⬇ PDF</button>
                </div>
              </div>
            );
          })}
          {invoices.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No invoices yet.</p>}
        </div>
      )}
    </div>
  );
}
