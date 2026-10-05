'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { API_BASE } from '../../lib/api';

const FEATURES = [
  { icon: '🏢', title: 'Smart workspaces', text: 'Desks, cabins & meeting rooms in one place' },
  { icon: '📊', title: 'Real-time insights', text: 'Occupancy, revenue & member analytics' },
  { icon: '⚡', title: 'Automated billing', text: 'Invoices, payments & reminders on autopilot' },
];

const STATS = [
  { value: '19', label: 'Workspaces' },
  { value: '42%', label: 'Occupancy' },
  { value: '24/7', label: 'Access' },
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

  const brandName = brand?.brandName || 'Techub Co-Working';

  return (
    <div className="min-h-screen flex bg-[#f4f5f7]">
      {/* Left — brand showcase */}
      <div className="hidden lg:flex w-[52%] min-h-screen self-stretch relative overflow-hidden flex-col justify-between p-12 text-white"
        style={{ background: 'linear-gradient(150deg, #0b2e2b 0%, #134e4a 45%, #0f766e 100%)' }}>
        {/* Ambient shapes */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full bg-white/[0.06] blur-[100px]" />
          <div className="absolute bottom-0 -left-24 w-[420px] h-[420px] rounded-full bg-teal-300/20 blur-[110px]" />
          <div
            className="absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
              backgroundSize: '52px 52px',
              maskImage: 'radial-gradient(ellipse 75% 65% at 30% 30%, black 20%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at 30% 30%, black 20%, transparent 75%)',
            }}
          />
        </div>

        <div className="relative flex items-center gap-3">
          {brand?.logoUrl ? (
            <img src={`${API_BASE}${brand.logoUrl}`} alt={brandName} className="h-11 w-11 object-contain rounded-xl bg-white/10 p-1" />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center text-xl font-extrabold backdrop-blur">
              {brandName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-[17px] font-bold tracking-tight">{brandName}</span>
        </div>

        <div className="relative max-w-lg">
          <h2 className="text-[40px] leading-[1.12] font-extrabold tracking-tight mb-4">
            Workspaces that<br />work for you.
          </h2>
          <p className="text-teal-100/80 text-[15px] leading-relaxed mb-9">
            Manage members, bookings, billing and operations — everything your coworking space needs, in one beautiful dashboard.
          </p>
          <div className="space-y-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-3.5">
                <span className="w-10 h-10 rounded-xl bg-white/12 border border-white/20 flex items-center justify-center text-lg shrink-0 backdrop-blur">
                  {f.icon}
                </span>
                <div>
                  <p className="font-semibold text-[14.5px]">{f.title}</p>
                  <p className="text-teal-100/70 text-[13px]">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex gap-10">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="text-[26px] font-extrabold tracking-tight">{s.value}</p>
              <p className="text-teal-100/70 text-[12px] font-medium uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-10 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 right-0 w-[420px] h-[320px] bg-teal-200/40 blur-[120px] rounded-full" />
          <div className="absolute bottom-0 left-1/4 w-[380px] h-[300px] bg-teal-100/50 blur-[120px] rounded-full" />
        </div>

        <div className="relative w-full max-w-[400px] animate-fadeUp">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center text-xl font-extrabold text-white"
              style={{ background: 'linear-gradient(135deg, #134e4a, #0f766e)' }}>
              {brandName.charAt(0).toUpperCase()}
            </div>
            <span className="text-[17px] font-bold text-gray-900 tracking-tight">{brandName}</span>
          </div>

          <h1 className="text-[26px] font-extrabold text-gray-900 tracking-tight mb-1.5">Welcome back</h1>
          <p className="text-gray-500 text-[14px] mb-7">Sign in to your workspace to continue</p>

          <div className="bg-white rounded-[22px] border border-gray-200 p-7 shadow-[0_20px_50px_rgba(0,0,0,0.08)] relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-teal-500 to-transparent" />
            <form onSubmit={handleSubmit}>
              {resetDone && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-3 mb-4">
                  Password reset successfully. Please sign in with your new password.
                </div>
              )}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">
                  {error}
                </div>
              )}
              <div className="mb-4">
                <label className="label">Email address</label>
                <div className="relative">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  <input
                    type="email"
                    className="input !pl-10 !py-3"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </div>
              </div>
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label !mb-0">Password</label>
                  <a href="/forgot-password" className="text-[12.5px] font-semibold text-teal-700 hover:text-teal-800 transition-colors">Forgot password?</a>
                </div>
                <div className="relative">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input !pl-10 !pr-11 !py-3"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
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
              <button type="submit" className="btn-primary btn-shine w-full !py-3.5 !text-[15px] !rounded-xl" disabled={busy}>
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : 'Sign in →'}
              </button>
            </form>
          </div>

          {!brand?.hidePoweredBy && (
            <p className="text-center text-xs text-gray-400 mt-6">Powered by CoworkOS</p>
          )}
          {brand?.supportEmail && (
            <p className="text-center text-gray-400 text-xs mt-2">Need help? {brand.supportEmail}</p>
          )}
        </div>
      </div>
    </div>
  );
}
