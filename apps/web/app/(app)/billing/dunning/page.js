'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../context/AuthContext';
import {
  PageHeader,
  DataTable,
  Badge,
  Spinner,
  ErrorBanner,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const money = (n) => `Rs ${Number(n || 0).toLocaleString()}`;
const LEVEL_TONE = { 1: 'amber', 2: 'orange', 3: 'red' };
const LEVEL_EMOJI = { 1: '🔔', 2: '⚠️', 3: '🚨' };

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toISOString().slice(0, 10);
}

export default function DunningPage() {
  const { allowed } = useRequireRoles('ceo', 'admin', 'finance_officer');
  const [overdue, setOverdue] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [o, l] = await Promise.all([
        api.get('/dunning/overdue'),
        api.get('/dunning/logs'),
      ]);
      setOverdue(o.items || []);
      setLogs(l.logs || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const runReminders = async () => {
    if (!confirm('Send due reminders for all overdue invoices now?')) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await api.post('/dunning/run');
      setResult(r);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  if (allowed === null) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const totalBalance = overdue.reduce((s, i) => s + Number(i.balance || 0), 0);
  const byLevel = { 1: 0, 2: 0, 3: 0 };
  overdue.forEach((i) => { byLevel[i.level] = (byLevel[i.level] || 0) + 1; });

  return (
    <div>
      <PageHeader
        title="Dunning — Overdue Reminders"
        sub="Automatic payment reminders, escalating by how overdue an invoice is."
        actions={
          <button className="btn-primary" onClick={runReminders} disabled={running || loading}>
            {running ? 'Sending…' : '▶ Run reminders now'}
          </button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}
      {result && (
        <div className="card mb-4 p-4 text-sm">
          ✅ Processed <b>{result.processed}</b> overdue invoices — sent <b>{result.sent}</b> reminders
          {result.skipped ? <span> ({result.skipped} skipped)</span> : null}.
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-1">Overdue invoices</div>
              <div className="text-2xl font-bold text-gray-900">{overdue.length}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-1">Total overdue</div>
              <div className="text-2xl font-bold text-red-700">{money(totalBalance)}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-1">🔔 Level 1 (1–7d)</div>
              <div className="text-2xl font-bold text-amber-700">{byLevel[1] || 0}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-1">🚨 Level 2–3 (8d+)</div>
              <div className="text-2xl font-bold text-red-700">{(byLevel[2] || 0) + (byLevel[3] || 0)}</div>
            </div>
          </div>

          <h2 className="text-lg font-bold text-gray-900 mb-3">Overdue invoices</h2>
          <DataTable
            columns={['Invoice', 'Member', 'Balance', 'Due date', 'Days overdue', 'Reminder level', 'Last sent']}
            rows={overdue.map((i) => [
              <span key="n" className="font-medium text-gray-900">{i.number}</span>,
              <span key="m">{i.memberName || '—'}</span>,
              <span key="b" className="font-medium text-red-700">{money(i.balance)}</span>,
              <span key="d">{fmtDate(i.dueDate)}</span>,
              <span key="do">{i.daysOverdue}d</span>,
              <span key="l">
                <Badge tone={LEVEL_TONE[i.level] || 'slate'}>
                  {LEVEL_EMOJI[i.level] || ''} L{i.level} — {i.levelLabel}
                </Badge>
              </span>,
              <span key="s">{i.lastReminderLevel ? `Level ${i.lastReminderLevel} sent` : <span className="text-slate-500">Not sent yet</span>}</span>,
            ])}
            empty="No overdue invoices. 🎉"
          />

          <h2 className="text-lg font-bold text-gray-900 mt-5 mb-3">Reminder history</h2>
          <DataTable
            columns={['Sent at', 'Invoice', 'Member', 'Level', 'Channel']}
            rows={logs.map((l) => [
              <span key="t">{new Date(l.sentAt).toLocaleString()}</span>,
              <span key="n" className="font-medium text-gray-900">{l.invoice?.number || '—'}</span>,
              <span key="m">{l.invoice?.memberName || '—'}</span>,
              <span key="l">
                <Badge tone={LEVEL_TONE[l.level] || 'slate'}>
                  {LEVEL_EMOJI[l.level] || ''} {l.levelLabel}
                </Badge>
              </span>,
              <span key="c">{l.channel}</span>,
            ])}
            empty="No reminders sent yet."
          />
        </>
      )}
    </div>
  );
}
