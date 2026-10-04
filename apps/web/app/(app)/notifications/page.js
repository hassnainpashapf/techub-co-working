'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

const TYPE_ICONS = {
  rent_due: '💰',
  contract_expiry: '📄',
  task_assigned: '✅',
  general: '🔔',
};

const TYPE_LABELS = {
  rent_due: 'Rent due',
  contract_expiry: 'Contract',
  task_assigned: 'Task',
  general: 'General',
};

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all'); // all | unread
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);

  const LIMIT = 20;

  async function load(p = page, f = filter, t = type) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: LIMIT });
      if (f === 'unread') params.set('unread', '1');
      if (t) params.set('type', t);
      const data = await api.get(`/notifications?${params}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1, filter, type); }, [filter, type]);

  const markRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch { /* silent */ }
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-1">Your alerts and reminders.</p>
        </div>
        <button onClick={markAllRead} className="btn-secondary">Mark all read</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${filter === 'all' ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-800'}`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${filter === 'unread' ? 'bg-[#0f766e] text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-800'}`}
        >
          Unread
        </button>
        <select value={type} onChange={(e) => setType(e.target.value)} className="input !w-auto ml-2">
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <div className="card-premium p-2">
        {loading ? (
          <p className="text-gray-500 text-sm p-6 text-center">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-gray-500 text-sm p-6 text-center">No notifications.</p>
        ) : (
          items.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-4 py-3.5 rounded-xl transition-colors ${n.isRead ? '' : 'bg-[#0f766e]/[0.07] border border-[#0f766e]/20'}`}
            >
              <span className="text-xl mt-0.5">{TYPE_ICONS[n.type] || '🔔'}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-[13.5px] ${n.isRead ? 'text-gray-500' : 'text-gray-900 font-medium'}`}>{n.message}</p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {TYPE_LABELS[n.type] || n.type} · {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
              {!n.isRead && (
                <button onClick={() => markRead(n.id)} className="text-[12px] text-teal-700 hover:text-teal-700 shrink-0 mt-1">
                  Mark read
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-5">
          <button disabled={page <= 1} onClick={() => load(page - 1)} className="btn-secondary disabled:opacity-40">Prev</button>
          <span className="text-[13px] text-gray-500">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => load(page + 1)} className="btn-secondary disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
