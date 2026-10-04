'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  PageHeader,
  DataTable,
  Badge,
  Spinner,
  ErrorBanner,
} from '../../../components/ui';

export default function RemindersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState('');

  const refresh = async () => {
    setError('');
    try {
      const d = await api.get('/notifications');
      setNotifications(d.notifications || d || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markRead(id) {
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() })));
    } catch (e) {
      setError(e.message);
    }
  }

  async function generateReminders() {
    setGenerating(true);
    setGenResult('');
    setError('');
    try {
      const d = await api.post('/notifications/generate');
      const created = d.created ?? d.count ?? (d.notifications ? d.notifications.length : 0);
      const skipped = d.skipped ?? 0;
      setGenResult(`Generated ${created} reminder(s)${skipped ? `, skipped ${skipped}` : ''}.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Spinner />;

  const unread = notifications.filter((n) => !n.read && !n.readAt);

  return (
    <div>
      <PageHeader
        title="Reminders"
        sub={`${unread.length} unread notification(s)`}
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={markAllRead} disabled={unread.length === 0}>Mark all read</button>
            <button className="btn-primary" onClick={generateReminders} disabled={generating}>
              {generating ? 'Generating…' : 'Generate rent-due reminders'}
            </button>
          </div>
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />
      {genResult && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">{genResult}</div>}

      <div className="card">
        <DataTable
          columns={[
            {
              key: 'title',
              label: 'Notification',
              render: (r) => (
                <div className={!r.read && !r.readAt ? 'font-semibold text-gray-900' : 'text-gray-500'}>
                  <p>{r.title || r.message?.slice(0, 60) || 'Notification'}</p>
                  {r.message && <p className="text-xs text-gray-500 font-normal">{r.message}</p>}
                </div>
              ),
            },
            { key: 'type', label: 'Type', render: (r) => <Badge tone="blue">{r.type || 'general'}</Badge> },
            {
              key: 'date',
              label: 'Date',
              render: (r) => (r.createdAt ? String(r.createdAt).slice(0, 16).replace('T', ' ') : '—'),
            },
            {
              key: 'status',
              label: 'Status',
              render: (r) => (
                r.read || r.readAt ? (
                  <Badge tone="slate">Read</Badge>
                ) : (
                  <Badge tone="amber">Unread</Badge>
                )
              ),
            },
            {
              key: 'actions',
              label: 'Actions',
              render: (r) =>
                !r.read && !r.readAt ? (
                  <button className="btn-secondary btn-sm" onClick={() => markRead(r.id)}>Mark read</button>
                ) : null,
            },
          ]}
          rows={notifications}
          empty={{ title: 'No notifications', hint: 'Generate rent-due reminders to notify members.' }}
        />
      </div>
    </div>
  );
}
