'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, API_BASE } from '../../lib/api';

function VerifyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }
    fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error?.message || 'Verification failed.');
        setStatus('success');
        setMessage(data.message || 'Email verified successfully.');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.message);
      });
  }, [token]);

  const resend = async (e) => {
    e.preventDefault();
    setResending(true);
    try {
      await api.post('/auth/resend-verification', { email });
      setMessage('If the email exists and is unverified, a new link has been sent.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-4">
      <div className="card-premium w-full max-w-sm p-8 text-center">
        {status === 'verifying' && (
          <>
            <div className="animate-spin w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
            <h1 className="text-xl font-bold text-white">Verifying…</h1>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="text-5xl mb-4">✅</div>
            <h1 className="text-xl font-bold text-white mb-2">Email verified!</h1>
            <p className="text-sm text-slate-400 mb-6">{message}</p>
            <button onClick={() => router.push('/login')} className="btn-primary w-full">Go to Login</button>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-white mb-2">Verification failed</h1>
            <p className="text-sm text-slate-400 mb-6">{message}</p>
            <form onSubmit={resend} className="text-left">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Resend verification link</label>
              <input type="email" className="input mb-3" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              <button type="submit" className="btn-secondary w-full" disabled={resending}>{resending ? 'Sending…' : 'Resend Link'}</button>
            </form>
            <button onClick={() => router.push('/login')} className="mt-4 text-xs text-slate-400 hover:text-white">Back to login</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#0a0a14] text-white">Loading…</div>}>
      <VerifyContent />
    </Suspense>
  );
}
