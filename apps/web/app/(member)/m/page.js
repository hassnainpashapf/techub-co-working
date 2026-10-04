'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { Spinner, ErrorBanner, Badge } from '../../../components/ui';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;

export default function MemberHome() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/dashboard')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;

  const contract = data?.myContract;
  const dues = data?.myDues || 0;
  const bookings = data?.myBookings || [];
  const invoices = data?.myInvoices || [];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold text-gray-900">Welcome back 👋</h1>

      {/* Dues card */}
      <div className={`card-premium p-5 ${dues > 0 ? 'border-red-200' : 'border-emerald-200'}`}>
        <div className="text-sm text-gray-500">Outstanding dues</div>
        <div className={`text-3xl font-extrabold mt-1 ${dues > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
          {money(dues)}
        </div>
        {dues > 0 && (
          <Link href="/m/invoices" className="btn-primary text-sm mt-3 inline-block">View & Pay</Link>
        )}
        {dues === 0 && <div className="text-sm text-emerald-400 mt-2">✓ All clear! No pending dues.</div>}
      </div>

      {/* Contract card */}
      {contract && (
        <div className="card-premium p-5">
          <h2 className="font-bold text-gray-900 mb-2">My Membership</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs text-gray-500">Unit</div><div className="text-gray-900 font-medium">{contract.unit?.code} ({contract.unit?.type})</div></div>
            <div><div className="text-xs text-gray-500">Status</div><Badge tone="green">{contract.status}</Badge></div>
            <div><div className="text-xs text-gray-500">Start</div><div className="text-gray-900">{contract.startDate?.slice(0, 10)}</div></div>
            <div><div className="text-xs text-gray-500">End</div><div className="text-gray-900">{contract.endDate?.slice(0, 10) || '—'}</div></div>
          </div>
        </div>
      )}

      {/* Upcoming bookings */}
      <div className="card-premium p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-900">Upcoming Bookings</h2>
          <Link href="/m/bookings" className="text-xs text-teal-700 hover:text-violet-700">View all →</Link>
        </div>
        {bookings.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming bookings.</p>
        ) : (
          <div className="space-y-2">
            {bookings.slice(0, 3).map((b) => (
              <div key={b.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200">
                <div>
                  <div className="text-sm font-medium text-gray-900">{b.title}</div>
                  <div className="text-xs text-gray-500">{b.unit?.code} · {new Date(b.startAt).toLocaleString()}</div>
                </div>
                <Badge tone="green">{b.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/m/bookings" className="card-premium p-4 text-center hover:border-teal-500/40 transition-colors">
          <div className="text-2xl mb-1">📅</div>
          <div className="text-sm font-medium text-gray-900">Book a Space</div>
        </Link>
        <Link href="/m/tickets" className="card-premium p-4 text-center hover:border-teal-500/40 transition-colors">
          <div className="text-2xl mb-1">🎫</div>
          <div className="text-sm font-medium text-gray-900">Raise a Ticket</div>
        </Link>
      </div>
    </div>
  );
}
