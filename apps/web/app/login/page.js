'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { API_BASE } from '../../lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [brand, setBrand] = useState(null);

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('reset') === '1') setResetDone(true);
    } catch (_e) { /* ignore */ }
    // White-label branding (public, no auth)
    fetch(`${API_BASE}/white-label/public`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.branding) setBrand(d.branding); })
      .catch(() => { /* keep defaults */ });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const me = await login(email.trim(), password);
      if (me?.mustChangePassword) { window.location = '/change-password'; return; }
      window.location = me?.role === 'member' ? '/portal' : '/dashboard';
    } catch (err) {
      setError(err.message || 'Login failed');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          {brand?.logoUrl ? (
            <img src={`${API_BASE}${brand.logoUrl}`} alt={brand.brandName} className="inline-block h-14 w-14 object-contain rounded-xl mb-3" />
          ) : (
            <div
              className="inline-flex text-white rounded-xl h-14 w-14 items-center justify-center text-2xl font-bold mb-3"
              style={{ background: brand?.primaryColor || '#7c3aed' }}
            >
              {(brand?.brandName || 'C').charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="text-2xl font-bold text-white">{brand?.brandName || 'Coworking SaaS'}</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to your workspace</p>
          {brand?.supportEmail && (
            <p className="text-slate-500 text-xs mt-1">Need help? {brand.supportEmail}</p>
          )}
        </div>

        <div className="card !p-7">
          <form onSubmit={handleSubmit}>
            {resetDone && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm rounded-lg px-4 py-3 mb-4">
                Password reset successfully. Please sign in with your new password.
              </div>
            )}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">
                {error}
              </div>
            )}
            <div className="mb-4">
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="mb-5">
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <a href="/forgot-password" className="block text-center text-sm text-slate-400 hover:text-white mt-4">Forgot password?</a>
        </div>
        {!brand?.hidePoweredBy && (
          <p className="text-center text-xs text-slate-600 mt-4">Powered by CoworkOS</p>
        )}

        <div className="mt-4 bg-slate-800 rounded-xl p-4 text-sm">
          <p className="text-slate-300 font-semibold mb-2">Demo logins</p>
          <div className="space-y-1 text-slate-400 text-xs">
            <p><span className="text-slate-200">ceo@demo.com</span> — CEO</p>
            <p><span className="text-slate-200">admin@demo.com</span> — Admin</p>
            <p><span className="text-slate-200">member@demo.com</span> — Member</p>
            <p className="pt-1">Password: <span className="text-slate-200 font-mono">demo1234</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
