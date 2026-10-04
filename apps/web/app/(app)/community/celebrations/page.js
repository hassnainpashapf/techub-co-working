'use client';

// Phase 40 Track 1: Birthday & Anniversary automation — celebrations page.

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, DataTable, Spinner, EmptyState, ErrorBanner, Badge } from '../../../../components/ui';
import { MilestonesList } from '../../../../components/MilestonesList'; // Phase 40 Track 8

const DAY_OPTS = [7, 30, 90];

export default function CelebrationsPage() {
  const [tab, setTab] = useState('celebrations'); // Phase 40 Track 8: celebrations | milestones
  const [days, setDays] = useState(30);
  const [items, setItems] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');

  async function load(d = days) {
    setLoading(true);
    setError('');
    try {
      const [up, lg] = await Promise.all([
        api.get(`/celebrations/upcoming?days=${d}`),
        api.get('/celebrations/log?limit=50'),
      ]);
      setItems(up.items || []);
      setLog(lg.log || []);
    } catch (e) {
      setError(e.message || 'Failed to load celebrations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function runNow() {
    setTriggering(true);
    setTriggerMsg('');
    try {
      const r = await api.post('/celebrations/trigger', {});
      const sent = (r.results || []).filter((x) => x.sent).length;
      setTriggerMsg(`Done — ${sent} celebration${sent === 1 ? '' : 's'} sent`);
      load();
    } catch (e) {
      setTriggerMsg(e.message || 'Failed');
    } finally {
      setTriggering(false);
    }
  }

  const bdays = items.filter((i) => i.kind === 'birthday').length;
  const annivs = items.filter((i) => i.kind === 'anniversary').length;

  return (
    <div>
      <PageHeader
        title="🎉 Celebrations"
        subtitle="Birthdays & member anniversaries — automated emails + loyalty points"
        actions={
          <button
            onClick={runNow}
            disabled={triggering}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-700 to-indigo-600 text-gray-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {triggering ? 'Sending…' : 'Run now (today)'}
          </button>
        }
      />
      {triggerMsg && <div className="mb-4 text-sm text-emerald-300">{triggerMsg}</div>}
      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2 mb-4">
        {[['celebrations', '🎉 Celebrations'], ['milestones', '🏆 Milestones']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === id ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'milestones' ? <MilestonesList limit={20} /> : (<>
      <div className="flex gap-2 mb-4">
        {DAY_OPTS.map((d) => (
          <button
            key={d}
            onClick={() => { setDays(d); load(d); }}
            className={`px-3 py-1.5 rounded-lg text-sm ${days === d ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-100'}`}
          >
            Next {d} days
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="🎂 Birthdays" value={bdays} />
            <StatCard label="🎉 Anniversaries" value={annivs} />
            <StatCard label="📅 Upcoming" value={items.length} />
            <StatCard label="✉️ Sent (log)" value={log.length} />
          </div>

          <h3 className="text-lg font-semibold text-gray-900 mb-3">Upcoming</h3>
          {items.length === 0 ? <EmptyState title="Koi celebration nahi" message="Selected period me koi birthday ya anniversary nahi hai." /> : (
            <DataTable
              columns={[
                { key: 'kind', title: 'Type', render: (r) => r.kind === 'birthday' ? '🎂 Birthday' : `🎉 Anniversary (${r.years}y)` },
                { key: 'memberName', title: 'Member' },
                { key: 'date', title: 'Date' },
                { key: 'daysAway', title: 'In', render: (r) => r.daysAway === 0 ? <Badge color="green">Today</Badge> : `${r.daysAway} days` },
              ]}
              rows={items}
              rowKey={(r) => `${r.kind}-${r.memberId}-${r.date}`}
            />
          )}

          <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-3">Recently sent</h3>
          {log.length === 0 ? <EmptyState title="Abhi kuch nahi bheja" message="Jab birthday/anniversary emails jayengi to yahan log dikhega." /> : (
            <DataTable
              columns={[
                { key: 'kind', title: 'Type', render: (r) => r.kind === 'birthday' ? '🎂 Birthday' : '🎉 Anniversary' },
                { key: 'member', title: 'Member', render: (r) => r.member?.name || r.memberId },
                { key: 'year', title: 'Year' },
                { key: 'sentAt', title: 'Sent at', render: (r) => new Date(r.sentAt).toLocaleString() },
              ]}
              rows={log}
              rowKey={(r) => r.id}
            />
          )}
        </>)}</>)}
    </div>
  );
}
