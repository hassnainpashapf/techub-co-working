'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setSaving(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      router.push('/login?reset=1');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a14] px-4">
      <div className="card-premium w-full max-w-sm p-8">
        <h1 className="text-2xl font-extrabold text-white mb-2">New password</h1>
        <p className="text-sm text-slate-400 mb-6">Choose a strong password for your account.</p>
        <form onSubmit={submit}>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">New password</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Confirm password</label>
            <input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-300 mb-3">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Set new password'}</button>
        </form>
        <a href="/login" className="block text-center text-sm text-slate-400 hover:text-white mt-5">← Back to login</a>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>}>
      <ResetForm />
    </Suspense>
  );
}
