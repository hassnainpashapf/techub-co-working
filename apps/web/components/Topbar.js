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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
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
        <div ref={boxRef} className="relative">
          <div className="flex items-center gap-2.5 bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2 w-[240px] text-slate-500 focus-within:border-blue-500/40 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              id="topbar-search"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (totalHits > 0) setDropOpen(true); }}
              onKeyDown={(e) => { if (e.key === 'Escape') { setDropOpen(false); setQuery(''); } }}
              className="bg-transparent outline-none text-[13.5px] text-slate-200 placeholder-slate-600 flex-1 w-full"
            />
            {searching ? (
              <span className="animate-spin w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full" />
            ) : (
              <kbd className="text-[11px] text-slate-600 font-medium">⌘/</kbd>
            )}
          </div>
          {dropOpen && results && (
            <div className="absolute right-0 top-full mt-2 w-[340px] max-h-[420px] overflow-y-auto rounded-xl border border-white/10 bg-[#12121f] shadow-2xl shadow-black/60 z-50">
              {totalHits === 0 ? (
                <div className="px-4 py-6 text-center text-[13px] text-slate-500">No results for “{query.trim()}”</div>
              ) : (
                groups.map((g) => (
                  <div key={g.key} className="py-1.5">
                    <div className="px-4 py-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{g.label}</div>
                    {g.items.map((item) => (
                      <button
                        key={`${g.key}-${item.id}`}
                        onClick={() => go(item.path)}
                        className="w-full text-left px-4 py-2 hover:bg-white/[0.05] transition-colors"
                      >
                        <div className="text-[13px] font-medium text-slate-100 truncate">{item.title}</div>
                        {item.subtitle && <div className="text-[11.5px] text-slate-500 truncate">{item.subtitle}</div>}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></svg>
        </button>
        <button
          onClick={startTour}
          title="Take a tour"
          className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>
        <a href="/notifications" className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors">
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
