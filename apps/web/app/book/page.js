'use client';

import { useEffect, useState } from 'react';
import { API_BASE } from '../../lib/api';

const inputCls = 'w-full rounded-lg bg-white border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-slate-500 outline-none focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/20';

export default function PublicBookPage() {
  const [tenantName, setTenantName] = useState('');
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', unitId: '', date: '', startTime: '09:00', endTime: '10:00', notes: '' });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/public/units`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error?.message || 'Could not load spaces.');
        setTenantName(d.tenant?.name || '');
        setUnits(d.units || []);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.unitId) return setError('Please select a space.');
    if (!form.date) return setError('Please pick a date.');
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/public/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'Request failed.');
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold bg-gradient-to-r from-teal-500 to-[#5eead4] bg-clip-text text-transparent">
              {tenantName || 'Book a Space'}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">Request a booking — no account needed</p>
          </div>
          <a href="/login" className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5">
            Staff login
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {done ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-2xl font-bold mb-2">Request received!</h2>
            <p className="text-sm text-gray-600">
              Thank you, {form.name.split(' ')[0] || 'there'}. Our team will confirm your booking shortly at {form.email}.
            </p>
            <button
              onClick={() => { setDone(false); setForm({ name: '', email: '', phone: '', unitId: '', date: '', startTime: '09:00', endTime: '10:00', notes: '' }); }}
              className="mt-6 text-xs text-gray-500 underline hover:text-gray-900"
            >
              Make another request
            </button>
          </div>
        ) : loading ? (
          <div className="text-center py-16 text-gray-500 text-sm">Loading available spaces…</div>
        ) : loadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{loadError}</div>
        ) : (
          <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-gray-50 p-6 md:p-8 space-y-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Full name *</label>
                <input className={inputCls} value={form.name} onChange={set('name')} placeholder="Your name" required minLength={2} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Phone *</label>
                <input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="03xx xxxxxxx" required minLength={7} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email *</label>
              <input type="email" className={inputCls} value={form.email} onChange={set('email')} placeholder="you@example.com" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Space *</label>
              <select className={inputCls} value={form.unitId} onChange={set('unitId')} required>
                <option value="">— Select a space —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} · {u.type} · {u.capacity} seats{u.monthlyPrice ? ` · Rs ${Number(u.monthlyPrice).toLocaleString()}/mo` : ''}
                  </option>
                ))}
              </select>
              {units.length === 0 && <p className="text-xs text-amber-700 mt-1.5">No spaces currently bookable — please try later.</p>}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Date *</label>
                <input type="date" className={inputCls} value={form.date} min={today} onChange={set('date')} required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">From *</label>
                <input type="time" className={inputCls} value={form.startTime} onChange={set('startTime')} required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">To *</label>
                <input type="time" className={inputCls} value={form.endTime} onChange={set('endTime')} required />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Notes</label>
              <textarea className={inputCls} rows={3} value={form.notes} onChange={set('notes')} placeholder="Anything we should know?" maxLength={1000} />
            </div>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            <button
              type="submit"
              disabled={sending || units.length === 0}
              className="w-full rounded-xl bg-gradient-to-r from-teal-700 to-[#0f766e] py-3 text-sm font-bold hover:from-teal-600 hover:to-[#0f766e] disabled:opacity-50 transition"
            >
              {sending ? 'Sending…' : 'Request Booking'}
            </button>
            <p className="text-[11px] text-slate-500 text-center">Our team reviews every request and confirms by email.</p>
          </form>
        )}
      </main>
    </div>
  );
}
