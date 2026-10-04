'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { startTour } from './OnboardingTour';

const TITLES = {
  '/dashboard': 'Overview',
  '/spaces': 'Workspaces',
  '/discover': 'Discover Booking',
  '/bookings': 'Booking History',
  '/users': 'Team Members',
  '/team': 'Team Overview',
  '/spaces/overview': 'Workspaces Overview',
  '/investor/overview': 'Investor Overview',
  '/school/overview': 'School Overview',
  '/launchpad/overview': 'Launchpad Overview',
  '/message/overview': 'Message Overview',
  '/finance': 'Investor',
  '/members': 'School',
  '/tasks': 'Launchpad',
  '/reminders': 'Message',
  '/settings': 'Settings',
  '/reports': 'Support',
  '/billing': 'Billing',
  '/attendance': 'Attendance',
};

export default function Topbar({ onMenuClick, sidebarOpen }) {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [userDropOpen, setUserDropOpen] = useState(false);
  const debounceRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined') setPath(window.location.pathname);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get('/notifications/unread-count');
        const count = data.count ?? data.unreadCount ?? 0;
        if (!cancelled) setUnread(Number(count) || 0);
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

  // Global search — debounced
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.get(`/search?q=${encodeURIComponent(q)}`);
        // Phase 45: smart-search ki extra entities (contracts, vendors, events, event tickets) bhi merge karo — staff-only, members par 403 silent skip
        try {
          const ss = await api.get(`/smart-search?q=${encodeURIComponent(q)}`);
          const extra = (ss.results || []).map((r) => ({ ...r, path: r.link || r.path }));
          const byEntity = {};
          extra.forEach((r) => { (byEntity[r.entity] = byEntity[r.entity] || []).push(r); });
          if (byEntity.contracts?.length) data.contracts = byEntity.contracts;
          if (byEntity.vendors?.length) data.vendors = byEntity.vendors;
          if (byEntity.events?.length) data.events = byEntity.events;
          if (byEntity.eventTickets?.length) data.eventTickets = byEntity.eventTickets;
        } catch { /* smart-search unavailable for this role — skip */ }
        setResults(data);
        setDropOpen(true);
      } catch {
        setResults(null);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setDropOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (p) => {
    setDropOpen(false);
    setQuery('');
    setResults(null);
    window.location.href = p;
  };

  const groups = results
    ? [
        { key: 'members', label: 'Members', items: results.members || [] },
        { key: 'bookings', label: 'Bookings', items: results.bookings || [] },
        { key: 'invoices', label: 'Invoices', items: results.invoices || [] },
        { key: 'tickets', label: 'Tickets', items: results.tickets || [] },
        { key: 'units', label: 'Units', items: results.units || [] },
        { key: 'companies', label: 'Companies', items: results.companies || [] },
        { key: 'contracts', label: 'Contracts', items: results.contracts || [] },
        { key: 'vendors', label: 'Vendors', items: results.vendors || [] },
        { key: 'events', label: 'Events', items: results.events || [] },
        { key: 'eventTickets', label: 'Event Tickets', items: results.eventTickets || [] },
      ].filter((g) => g.items.length > 0)
    : [];
  const totalHits = groups.reduce((n, g) => n + g.items.length, 0);

  if (!user) return null;

  const title = TITLES[path] || 'Workspace';
  const parent = path.startsWith('/discover') || path.startsWith('/bookings') || path.startsWith('/spaces') ? 'Workspace' : 'Main';

  return (
    <header className="bg-white border-b border-gray-200 px-7 py-3.5 flex items-center justify-between sticky top-0 z-30 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="flex items-center gap-3 text-[14px] whitespace-nowrap">
        <button
          onClick={onMenuClick}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:text-teal-700 hover:bg-teal-50 transition-all duration-200 active:scale-95"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <span className="text-gray-900 font-bold text-[20px] tracking-tight">{title}</span>
        
        
      </div>
      <div className="flex items-center gap-2.5">
        <div ref={boxRef} className="relative">
          <div className="flex items-center gap-2.5 bg-gray-100 rounded-full border border-transparent px-3.5 py-2 w-[240px] text-gray-400 focus-within:border-teal-300 focus-within:bg-white transition-all duration-200">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              id="topbar-search"
              placeholder="Search members, invoices…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (totalHits > 0) setDropOpen(true); }}
              onKeyDown={(e) => { if (e.key === 'Escape') { setDropOpen(false); setQuery(''); } }}
              className="bg-transparent outline-none text-[13.5px] text-gray-900 placeholder-gray-400 flex-1 w-full"
            />
            {searching ? (
              <span className="animate-spin w-3.5 h-3.5 border-2 border-teal-600 border-t-transparent rounded-full" />
            ) : (
              <kbd className="text-[11px] text-gray-400 font-medium px-1.5 py-0.5 rounded bg-white border border-gray-200">⌘/</kbd>
            )}
          </div>
          {dropOpen && results && (
            <div className="absolute right-0 top-full mt-2 w-[340px] max-h-[420px] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl shadow-gray-200/60 z-50">
              {totalHits === 0 ? (
                <div className="px-4 py-4 text-center text-[13px] text-gray-500">No results for “{query.trim()}”</div>
              ) : (
                groups.map((g) => (
                  <div key={g.key} className="py-1.5">
                    <div className="px-4 py-1 text-[10.5px] font-bold uppercase tracking-wider text-gray-400">{g.label}</div>
                    {g.items.map((item) => (
                      <button
                        key={`${g.key}-${item.id}`}
                        onClick={() => go(item.path)}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors"
                      >
                        <div className="text-[13px] font-medium text-gray-900 truncate">{item.title}</div>
                        {item.subtitle && <div className="text-[11.5px] text-gray-500 truncate">{item.subtitle}</div>}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-teal-700 hover:bg-teal-50 transition-all duration-200 active:scale-95">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></svg>
        </button>
        <button
          onClick={startTour}
          title="Take a tour"
          className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-teal-700 hover:bg-teal-50 transition-all duration-200 active:scale-95"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>
        <a href="/notifications" className="relative w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-teal-700 hover:bg-teal-50 transition-all duration-200 active:scale-95">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          {unread > 0 && (
            <span className="absolute top-0.5 right-0.5 bg-gradient-to-br from-[#ef4444] to-[#dc2626] text-white text-[9px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center ring-2 ring-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </a>
        <div className="relative">
          <button
            onClick={() => setUserDropOpen(!userDropOpen)}
            className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <span className="text-right leading-tight hidden sm:block">
              <span className="block text-[13px] font-bold text-gray-900 truncate max-w-[120px]">{user.tenantName || user.name || 'Techub Studio'}</span>
              <span className="block text-[11px] text-gray-500 capitalize">{(user.role || 'admin').replace(/_/g, ' ')}</span>
            </span>
            <span className="relative shrink-0">
              <span className="w-9 h-9 rounded-full bg-[#134e4a] flex items-center justify-center text-white text-sm font-bold">
                {(user.name || user.email || 'U').charAt(0).toUpperCase()}
              </span>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-white" />
            </span>
          </button>
          {userDropOpen && (
            <div className="absolute right-0 top-full mt-2 w-44 rounded-xl bg-white border border-gray-200 shadow-xl p-1.5 z-50">
              <button
                onClick={() => { logout(); window.location = '/login'; }}
                className="w-full text-left px-3.5 py-2 rounded-lg text-[13.5px] font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
