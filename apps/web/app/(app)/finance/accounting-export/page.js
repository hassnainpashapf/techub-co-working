'use client';

import { useState } from 'react';
import { api, API_BASE, getTokens } from '../../../../lib/api';
import { PageHeader, StatCard, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles } from '../../../../components/Protected';

const FORMATS = [
  {
    key: 'invoices.csv',
    title: 'Invoices',
    desc: 'Sales invoices — Xero invoice import format (InvoiceNumber, ContactName, dates, amounts). Proforma invoices excluded.',
    icon: '🧾',
    accent: 'blue',
  },
  {
    key: 'bills.csv',
    title: 'Bills',
    desc: 'Approved expenses as purchase bills — Xero bill import format (BillNumber, ContactName, AccountCode 310).',
    icon: '📄',
    accent: 'amber',
  },
  {
    key: 'payments.csv',
    title: 'Payments',
    desc: 'Received payments — bank-statement style CSV (Date, Amount, Description, Reference) for Xero bank import.',
    icon: '💳',
    accent: 'emerald',
  },
];

export default function AccountingExportPage() {
  useRequireRoles('ceo', 'admin', 'super_admin', 'finance_officer');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const download = async (key) => {
    setBusy(key);
    setError('');
    try {
      const { access } = getTokens();
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await fetch(`${API_BASE}/accounting-export/${key}?${qs.toString()}`, {
        headers: access ? { Authorization: `Bearer ${access}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = key.replace('.csv', `-${from || 'all'}-to-${to || 'all'}.csv`);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title="Accounting Export" sub="Xero / QuickBooks compatible CSV exports" />
      {error && <ErrorBanner message={error} />}

      <div className="card-premium p-5 mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <p className="text-xs text-gray-500">Dates optional — blank means all records.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {FORMATS.map((f) => (
          <div key={f.key} className="card-premium p-5 flex flex-col">
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">{f.title}</h3>
            <p className="text-xs text-gray-500 mb-4 flex-1">{f.desc}</p>
            <button
              className="btn-primary w-full"
              disabled={busy === f.key}
              onClick={() => download(f.key)}
            >
              {busy === f.key ? 'Preparing…' : '⬇ Download CSV'}
            </button>
          </div>
        ))}
      </div>

      <div className="card-premium p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">📘 Format guide — Xero import</h3>
        <ul className="text-xs text-gray-600 space-y-2 list-disc list-inside">
          <li><b>Invoices:</b> Xero → Business → Invoices → Import. Columns: InvoiceNumber, Reference, ContactName, InvoiceDate, DueDate, Description, Quantity, UnitAmount, Discount, AccountCode, TaxType, TaxAmount, Currency.</li>
          <li><b>Bills:</b> Xero → Business → Bills to pay → Import. Same column layout; AccountCode defaults to 310 (cost of sales).</li>
          <li><b>Payments:</b> Xero → Accounting → Bank accounts → Manage account → Import a statement. Bank-statement format: Date, Amount, Description, Reference.</li>
          <li>Dates are DD/MM/YYYY. Amounts are tax-exclusive; TaxType "None" means no tax.</li>
          <li>Only <b>standard</b> invoices are exported (proforma = quotes, never revenue). Only <b>approved</b> expenses are exported as bills.</li>
        </ul>
      </div>
    </div>
  );
}
