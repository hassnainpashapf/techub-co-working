'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Protected, { useRequireRoles, AccessDenied } from '../../components/Protected';
import { useAuth } from '../../context/AuthContext';

const NAV = [
  { label: 'Home', path: '/m', icon: '🏠' },
  { label: 'My Bookings', path: '/m/bookings', icon: '📅' },
  { label: 'My Invoices', path: '/m/invoices', icon: '🧾' },
  { label: 'My Tickets', path: '/m/tickets', icon: '🎫' },
  { label: 'Profile', path: '/m/profile', icon: '👤' },
];

function MemberNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-[#0c0c18]/90 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/m" className="font-extrabold text-white text-lg">
            <span className="text-violet-400">Techub</span> Member
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300 hidden sm:block">{user?.name}</span>
            <button onClick={logout} className="text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-3 py-1.5">
              Logout
            </button>
          </div>
        </div>
      </header>
      {/* Bottom nav (mobile-friendly) */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-[#0c0c18]/95 backdrop-blur border-t border-white/10">
        <div className="max-w-5xl mx-auto px-2 py-2 grid grid-cols-5">
          {NAV.map((item) => {
            const active = pathname === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex flex-col items-center py-1.5 rounded-lg text-[11px] font-medium transition-colors ${active ? 'text-violet-300' : 'text-slate-400 hover:text-white'}`}
              >
                <span className="text-xl mb-0.5">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export default function MemberLayout({ children }) {
  const { allowed, user } = useRequireRoles('member');
  // super_admin can also preview the member portal
  if (allowed === null) return null;
  if (!allowed && user?.role !== 'super_admin') return (
    <div className="min-h-screen bg-[#08080f] flex items-center justify-center p-4">
      <AccessDenied />
    </div>
  );
  return (
    <Protected>
      <div className="min-h-screen bg-[#08080f] pb-24">
        <MemberNav />
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </div>
    </Protected>
  );
}
