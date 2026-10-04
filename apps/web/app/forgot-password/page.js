'use client';

import { useState } from 'react';
import { api } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7] px-4">
      <div className="card-premium w-full max-w-sm p-8">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Reset password</h1>
        <p className="text-sm text-gray-500 mb-6">Enter your email and we&apos;ll send a reset link.</p>
        {sent ? (
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            If an account exists for that email, a reset link has been sent.
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email</label>
              <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
            </div>
            {error && <p className="text-sm text-red-300 mb-3">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Sending…' : 'Send reset link'}</button>
          </form>
        )}
        <a href="/login" className="block text-center text-sm text-gray-500 hover:text-gray-900 mt-5">← Back to login</a>
      </div>
    </div>
  );
}
