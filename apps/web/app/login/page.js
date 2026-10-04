'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { API_BASE } from '../../lib/api';

const DEMO_ACCOUNTS = [
  { email: 'ceo@demo.com', label: 'CEO' },
  { email: 'admin@demo.com', label: 'Admin' },
  { email: 'member@demo.com', label: 'Member' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
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

  function fillDemo(em) {
    setEmail(em);
    setPassword('demo1234');
    setError('');
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-10 overflow-hidden bg-[#f4f5f7]">
      {/* Ambient animated background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/4 w-[560px] h-[420px] bg-teal-200/40 blur-[130px] rounded-full animate-floatY" />
        <div className="absolute bottom-0 right-1/4 w-[520px] h-[380px] bg-teal-100/60 blur-[130px] rounded-full animate-floatY" style={{ animationDelay: '-3.5s' }} />
        <div className="absolute top-1/3 left-0 w-[380px] h-[380px] bg-teal-50 blur-[120px] rounded-full" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: 'linear-gradient(rgba(15,118,110,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(15,118,110,0.05) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 75%)',
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.06)_100%)]" />
      </div>

      <div className="relative w-full max-w-md animate-fadeUp">
        {/* Brand */}
        <div className="text-center mb-7">
          <div className="relative inline-block mb-4">
            <div className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-teal-500/30 to-teal-300/30 blur-xl opacity-70" />
            {brand?.logoUrl ? (
              <img src={`${API_BASE}${brand.logoUrl}`} alt={brand.brandName} className="relative inline-block h-16 w-16 object-contain rounded-2xl" />
            ) : (
              <div
                className="relative inline-flex text-white rounded-2xl h-16 w-16 items-center justify-center text-3xl font-extrabold border border-white/20 shadow-inner"
                style={{ background: `linear-gradient(135deg, ${brand?.primaryColor || '#134e4a'}, #0f766e)` }}
              >
                {(brand?.brandName || 'T').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <h1 className="text-[28px] font-extrabold text-gradient tracking-tight">{brand?.brandName || 'Techub Co-Working'}</h1>
          <p className="text-gray-500 text-sm mt-1.5 font-medium">Sign in to your workspace</p>
          {brand?.supportEmail && (
            <p className="text-gray-400 text-xs mt-1">Need help? {brand.supportEmail}</p>
          )}
        </div>

        {/* Glass card */}
        <div className="glass rounded-[24px] !p-8 shadow-[0_24px_60px_rgba(0,0,0,0.10)] relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-teal-500/60 to-transparent" />
          <form onSubmit={handleSubmit}>
            {resetDone && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-3 mb-4 animate-fadeUp">
                Password reset successfully. Please sign in with your new password.
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4 animate-fadeUp ">
                {error}
              </div>
            )}
            <div className="mb-4">
              <label className="label">Email</label>
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <input
                  type="email"
                  className="input !pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="mb-6">
              <label className="label">Password</label>
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input !pl-10 !pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  title={showPw ? 'Hide password' : 'Show password'}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {showPw ? (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></>) : (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)}
                  </svg>
                </button>
              </div>
            </div>
            <button type="submit" className="btn-primary btn-shine w-full !py-3 !text-[15px]" disabled={busy}>
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : 'Sign in'}
            </button>
          </form>
          <a href="/forgot-password" className="block text-center text-sm text-gray-500 hover:text-teal-700 mt-5 transition-colors font-medium">Forgot password?</a>
        </div>

        {!brand?.hidePoweredBy && (
          <p className="text-center text-xs text-gray-400 mt-5">Powered by CoworkOS</p>
        )}

        {/* Demo logins */}
        <div className="mt-4 glass rounded-[20px] p-5 text-sm animate-fadeUp" style={{ animationDelay: '0.15s' }}>
          <p className="text-gradient font-bold mb-3 text-[13px] uppercase tracking-wider">Demo logins — tap to fill</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => fillDemo(a.email)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                  email === a.email
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 bg-white hover:border-teal-400 hover:bg-teal-50'
                }`}
              >
                <p className="text-gray-900 text-[13px] font-semibold">{a.label}</p>
                <p className="text-gray-500 text-[11px] truncate">{a.email}</p>
              </button>
            ))}
          </div>
          <p className="text-gray-400 text-xs mt-3">Password: <span className="text-gray-700 font-mono">demo1234</span></p>
        </div>
      </div>
    </div>
  );
}
