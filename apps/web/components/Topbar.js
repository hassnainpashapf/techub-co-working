'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const TITLES = {
  '/dashboard': 'Overview',
  '/spaces': 'Workspaces',
  '/discover': 'Discover Booking',
  '/bookings': 'Booking History',
  '/rides': 'Ride Sharing',
  '/users': 'Team',
  '/finance': 'Investor',
  '/members': 'School',
  '/tasks': 'Launchpad',
  '/reminders': 'Message',
  '/settings': 'Settings',
  '/reports': 'Support',
  '/billing': 'Billing',
  '/attendance': 'Attendance',
};

export default function Topbar() {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [path, setPath] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setPath(window.location.pathname);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get('/notifications?unread=true');
        const list = data.notifications || data || [];
        if (!cancelled) setUnread(Array.isArray(list) ? list.length : 0);
      } catch {
        /* silent */
      }
    }
    load();
    const t = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!user) return null;

  const title = TITLES[path] || 'Workspace';
  const parent = path.startsWith('/discover') || path.startsWith('/bookings') || path.startsWith('/rides') || path.startsWith('/spaces') ? 'Workspace' : 'Main';

  return (
    <header className="bg-[#08080f]/95 backdrop-blur border-b border-white/[0.06] px-7 py-3.5 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-3 text-[14px] whitespace-nowrap">
        <span className="text-slate-500">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        </span>
        <span className="text-slate-500">{parent}</span>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{title}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2.5 bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2 w-[240px] text-slate-500 focus-within:border-blue-500/40 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            placeholder="Search"
            className="bg-transparent outline-none text-[13.5px] text-slate-200 placeholder-slate-600 flex-1 w-full"
          />
          <kbd className="text-[11px] text-slate-600 font-medium">⌘/</kbd>
        </div>
        <button className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></svg>
        </button>
        <a href="/reminders" className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          {unread > 0 && (
            <span className="absolute top-1 right-1 bg-blue-500 text-white text-[9px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </a>
      </div>
    </header>
  );
}
