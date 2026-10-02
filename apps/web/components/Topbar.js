'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Badge } from './ui';

export default function Topbar() {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);

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

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-30">
      <div>
        <p className="text-sm font-semibold text-slate-900 truncate max-w-xs">
          {user.tenantName || user.tenant?.name || 'Coworking'}
        </p>
        <p className="text-xs text-slate-500">
          Welcome back, {user.name || user.email}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <a
          href="/reminders"
          className="relative text-slate-500 hover:text-slate-800 text-xl"
          title="Notifications"
        >
          🔔
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </a>
        <Badge tone="indigo">{user.role?.replace(/_/g, ' ')}</Badge>
        <button onClick={logout} className="btn-secondary btn-sm">
          Logout
        </button>
      </div>
    </header>
  );
}
