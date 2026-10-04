'use client';

import { useState } from 'react';
import Protected from '../../components/Protected';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';
import Shortcuts from '../../components/Shortcuts';
import OnboardingTour from '../../components/OnboardingTour';
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
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-center gap-3 text-[13px]">
      <span className="text-amber-800">⚠️ Please verify your email address to secure your account.</span>
      {sent ? (
        <span className="text-emerald-700 font-medium">Verification email sent! Check your inbox.</span>
      ) : (
        <button onClick={send} disabled={sending} className="text-amber-700 underline hover:text-amber-900 font-medium">
          {sending ? 'Sending…' : 'Resend verification email'}
        </button>
      )}
    </div>
  );
}

export default function AppLayout({ children }) {
  return (
    <Protected>
      <div className="flex min-h-screen relative bg-[#f4f5f7]">
        <div className="relative z-10 flex min-h-screen w-full">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <Topbar />
            <Shortcuts />
            <VerifyBanner />
            <main className="flex-1 p-6 3xl:p-8 4xl:p-10 max-w-7xl 3xl:max-w-[1680px] 4xl:max-w-[2400px] w-full mx-auto">{children}</main>
          </div>
        </div>
        <OnboardingTour />
      </div>
    </Protected>
  );
}
