'use client';

import { useState } from 'react';
import Protected from '../../components/Protected';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';

function VerifyBanner() {
  const { user } = useAuth();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  if (!user || user.emailVerifiedAt) return null;
  const send = async () => {
    setSending(true);
    try { await api.post('/auth/send-verification'); setSent(true); }
    catch { /* ignore */ } finally { setSending(false); }
  };
  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2.5 flex items-center justify-center gap-3 text-[13px]">
      <span className="text-amber-200">⚠️ Please verify your email address to secure your account.</span>
      {sent ? (
        <span className="text-emerald-300 font-medium">Verification email sent! Check your inbox.</span>
      ) : (
        <button onClick={send} disabled={sending} className="text-amber-300 underline hover:text-amber-200 font-medium">
          {sending ? 'Sending…' : 'Resend verification email'}
        </button>
      )}
    </div>
  );
}

export default function AppLayout({ children }) {
  return (
    <Protected>
      <div className="flex min-h-screen relative bg-[#08080f]">
        {/* Ambient glows for rich luminous feel */}
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute -top-32 left-1/4 w-[500px] h-[300px] bg-blue-600/[0.07] blur-[120px] rounded-full" />
          <div className="absolute top-1/3 -right-32 w-[400px] h-[400px] bg-blue-700/[0.05] blur-[120px] rounded-full" />
          <div className="absolute -bottom-32 left-1/3 w-[450px] h-[300px] bg-fuchsia-600/[0.04] blur-[120px] rounded-full" />
        </div>
        <div className="relative z-10 flex min-h-screen w-full">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <Topbar />
            <VerifyBanner />
            <main className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</main>
          </div>
        </div>
      </div>
    </Protected>
  );
}
