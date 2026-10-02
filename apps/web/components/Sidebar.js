'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const STAFF = [
  'ceo',
  'admin',
  'operations_manager',
  'manager',
  'receptionist',
  'finance_officer',
  'office_boy',
];

export const NAV = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊', roles: [...STAFF, 'member'] },
  { path: '/spaces', label: 'Spaces', icon: '🏢', roles: ['ceo', 'admin', 'operations_manager', 'manager', 'receptionist'] },
  { path: '/members', label: 'Members', icon: '👥', roles: ['ceo', 'admin', 'operations_manager', 'manager', 'receptionist'] },
  { path: '/billing', label: 'Billing', icon: '🧾', roles: ['ceo', 'admin', 'finance_officer', 'member'] },
  { path: '/finance', label: 'Finance', icon: '💰', roles: ['ceo', 'admin', 'finance_officer'] },
  { path: '/attendance', label: 'Attendance', icon: '🕒', roles: [...STAFF] },
  { path: '/tasks', label: 'Tasks', icon: '✅', roles: ['ceo', 'admin', 'operations_manager', 'manager', 'office_boy'] },
  { path: '/bookings', label: 'Bookings', icon: '📅', roles: [...STAFF, 'member'] },
  { path: '/reminders', label: 'Reminders', icon: '🔔', roles: [...STAFF, 'member'] },
  { path: '/reports', label: 'Reports', icon: '📈', roles: ['ceo', 'admin', 'finance_officer'] },
  { path: '/users', label: 'Users', icon: '👤', roles: ['ceo', 'admin'] },
  { path: '/settings', label: 'Settings', icon: '⚙️', roles: ['ceo', 'admin'] },
];

export default function Sidebar() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setCurrent(window.location.pathname);
  }, []);

  if (!user) return null;
  const role = user.role;

  let items = NAV.filter((n) => n.roles.includes(role));
  if (role === 'member') {
    items = items.map((n) =>
      n.path === '/billing' ? { ...n, label: 'My Billing' } : n
    );
  }

  return (
    <aside className="w-60 shrink-0 bg-slate-900 text-slate-300 flex flex-col min-h-screen">
      <div className="px-5 py-5 border-b border-slate-800">
        <a href="/dashboard" className="flex items-center gap-2.5">
          <span className="bg-indigo-600 text-white rounded-lg h-9 w-9 flex items-center justify-center font-bold">
            C
          </span>
          <span className="text-white font-bold text-lg leading-tight">
            Coworking
            <span className="block text-xs font-medium text-slate-400">SaaS</span>
          </span>
        </a>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const active = current === item.path || current.startsWith(item.path + '/');
          return (
            <a
              key={item.path}
              href={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-slate-800 text-xs text-slate-500">
        <p className="font-medium text-slate-300 truncate">{user.name || user.email}</p>
        <p className="capitalize">{role.replace(/_/g, ' ')}</p>
      </div>
    </aside>
  );
}
