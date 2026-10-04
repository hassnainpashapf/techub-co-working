'use client';

// Phase 35 Track 9: forced password change (first login with temp password).
import { useState } from 'react';
import { api } from '../../lib/api';

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState('');
  const [next1, setNext1] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next1 !== next2) { setError('Naya password dobara same likhein.'); return; }
    setBusy(true);
    try {
      await api.post('/onboarding/change-password', { currentPassword: current, newPassword: next1 });
      window.location = '/dashboard';
    } catch (err) {
      setError(err.message || 'Password change nahi ho saka.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] px-4">
      <div className="card-premium w-full max-w-sm p-8">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">🔑 Password change karein</h1>
        <p className="text-sm text-gray-500 mb-6">Aap temporary password se login hue hain. Jaari rakhne ke liye naya password set karein.</p>
        <form onSubmit={submit}>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Maujooda (temporary) password</label>
            <input type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Naya password</label>
            <input type="password" className="input" value={next1} onChange={(e) => setNext1(e.target.value)} required autoComplete="new-password" placeholder="Min 8 chars, 1 capital, 1 number" />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Naya password (dobara)</label>
            <input type="password" className="input" value={next2} onChange={(e) => setNext2(e.target.value)} required autoComplete="new-password" />
          </div>
          {error && <p className="text-sm text-red-700 mb-3">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Save ho raha hai…' : 'Password set karo'}</button>
        </form>
      </div>
    </div>
  );
}
