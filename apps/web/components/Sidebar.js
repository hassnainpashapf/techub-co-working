'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

// Fobework-style sidebar — exact match to reference design
const ICONS = {
  overview: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  ),
  workspaces: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
  ),
  team: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  ),
  investor: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
  ),
  school: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
  ),
  launchpad: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
  ),
  message: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  ),
  support: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/></svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  ),
  chevronRight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  ),
  chevUpDown: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 9 12 5 16 9"/><polyline points="8 15 12 19 16 15" opacity="0.4"/></svg>
  ),
};

const NAV_MAIN = [
  { key: 'overview', label: 'Overview', path: '/dashboard', icon: 'overview' },
  {
    key: 'workspaces', label: 'Workspaces', path: '/spaces', icon: 'workspaces',
    children: [
      { label: 'Discover Booking', path: '/discover' },
      { label: 'Booking History', path: '/bookings' },
      { label: 'Booking Calendar', path: '/bookings/calendar' },
      { label: 'Floor Plan', path: '/spaces/floorplan' },
      { label: 'Ride Sharing', path: '/rides' },
    ],
  },
  { key: 'team', label: 'Team', path: '/users', icon: 'team',
    children: [
      { label: 'Team Members', path: '/users' },
      { label: 'Attendance', path: '/attendance' },
    ],
  },
  { key: 'investor', label: 'Investor', path: '/finance', icon: 'investor',
    children: [
      { label: 'Finance Overview', path: '/finance' },
      { label: 'Billing & Invoices', path: '/billing' },
      { label: 'Reports', path: '/reports' },
    ],
  },
  { key: 'school', label: 'School', path: '/members', icon: 'school',
    children: [
      { label: 'Members', path: '/members' },
      { label: 'Membership Plans', path: '/plans' },
    ],
  },
  { key: 'launchpad', label: 'Launchpad', path: '/tasks', icon: 'launchpad',
    children: [
      { label: 'Tasks', path: '/tasks' },
      { label: 'Tickets', path: '/tickets' },
      { label: 'Visitors', path: '/visitors' },
      { label: 'Reminders', path: '/reminders' },
    ],
  },
  { key: 'message', label: 'Message', path: '/reminders', icon: 'message' },
];

const NAV_OTHERS = [
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
  { key: 'support', label: 'Support', path: '/reports', icon: 'support' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [openMenu, setOpenMenu] = useState('workspaces');
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      setCurrent(p);
      if (p.startsWith('/discover') || p.startsWith('/bookings') || p.startsWith('/rides') || p.startsWith('/spaces')) {
        setOpenMenu('workspaces');
      } else if (p.startsWith('/users') || p.startsWith('/attendance')) {
        setOpenMenu('team');
      } else if (p.startsWith('/finance') || p.startsWith('/billing') || p.startsWith('/reports')) {
        setOpenMenu('investor');
      } else if (p.startsWith('/members')) {
        setOpenMenu('school');
      } else if (p.startsWith('/tasks') || p.startsWith('/reminders')) {
        setOpenMenu('launchpad');
      }
    }
  }, []);

  if (!user) return null;

  const isActive = (path) => current === path || current.startsWith(path + '/');
  const isChildActive = (children) => children?.some((c) => isActive(c.path));

  const renderItem = (item) => {
    const active = isActive(item.path) || isChildActive(item.children);
    const expanded = openMenu === item.key;
    return (
      <div key={item.key}>
        <a
          href={item.path}
          onClick={item.children ? (e) => { e.preventDefault(); setOpenMenu(expanded ? '' : item.key); } : undefined}
          className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-semibold transition-all duration-200 ${
            active
              ? 'text-white border border-violet-400/30 bg-gradient-to-b from-[#1c1c30] to-[#12121f] shadow-[0_0_24px_rgba(139,92,246,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]'
              : 'text-white/85 hover:text-white hover:bg-white/5 border border-transparent font-medium'
          }`}
        >
          <span className={active ? 'text-blue-200 drop-shadow-[0_0_6px_rgba(147,197,253,0.8)] brightness-125' : 'text-slate-300 brightness-110'}>{ICONS[item.icon]}</span>
          <span className="flex-1">{item.label}</span>
          {(item.children || item.chevron) && (
            <span className="transition-transform duration-200 text-slate-500">
              {item.children ? (expanded ? ICONS.chevron : ICONS.chevronRight) : ICONS.chevron}
            </span>
          )}
        </a>
        {item.children && expanded && (
          <div className="mt-1 ml-3 rounded-xl bg-white/[0.03] border border-white/[0.05] p-1.5 space-y-0.5 animate-[fadeSlideIn_0.25s_ease-out]">
            {item.children.map((child) => {
              const childActive = isActive(child.path);
              return (
                <a
                  key={child.path}
                  href={child.path}
                  className={`block px-3.5 py-2 rounded-xl text-[13.5px] font-medium transition-all duration-200 ${
                    childActive
                      ? 'text-white font-semibold bg-gradient-to-b from-[#1a1a2c] to-[#12121e] border border-violet-400/25 shadow-[0_0_20px_rgba(139,92,246,0.2),inset_0_1px_0_rgba(255,255,255,0.06)]'
                      : 'text-white/75 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {child.label}
                </a>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-[248px] shrink-0 bg-[#08080f] flex flex-col min-h-screen border-r border-white/[0.06]">
      {/* User card */}
      <div className="px-4 mb-5 relative">
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="flex items-center gap-3 px-2 py-1 w-full text-left rounded-xl hover:bg-white/5 transition-colors"
        >
          <span className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 border border-white/10 flex items-center justify-center text-white text-sm font-semibold overflow-hidden shrink-0">
            {(user.name || user.email || 'U').charAt(0).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-white text-[14px] font-semibold truncate">{user.tenantName || 'Techub Studio'}</p>
            <p className="text-slate-500 text-[12px] capitalize">{(user.role || 'admin').replace(/_/g, ' ')}</p>
          </div>
          <span className="text-slate-500">{ICONS.chevUpDown}</span>
        </button>
        {showUserMenu && (
          <div className="absolute left-4 right-4 top-full mt-1 rounded-xl bg-[#151528] border border-white/10 shadow-xl p-1.5 z-50 animate-[fadeSlideIn_0.2s_ease-out]">
            <button
              onClick={() => { logout(); window.location = '/login'; }}
              className="w-full text-left px-3.5 py-2 rounded-lg text-[13.5px] text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              Logout
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3.5 space-y-1 overflow-y-auto">
        <p className="px-3.5 pb-2 text-[12px] font-medium text-slate-600">Main</p>
        {NAV_MAIN.map(renderItem)}
        <p className="px-3.5 pt-5 pb-2 text-[12px] font-medium text-slate-600">Others</p>
        {NAV_OTHERS.map(renderItem)}
      </nav>
    </aside>
  );
}
