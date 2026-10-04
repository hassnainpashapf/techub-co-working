// Phase 48: member access credentials tab (PIN/RFID/mobile) for member detail modal.
'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DataTable, Badge, Spinner, ErrorBanner, Field, Modal } from './ui';

const TYPE_TONE = { pin: 'blue', rfid: 'violet', mobile: 'emerald' };

export default function MemberAccessTab({ memberId }) {
  const [creds, setCreds] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [c, s] = await Promise.all([
        api.get(`/access-credentials?memberId=${memberId}`),
        api.get(`/access-schedules?memberId=${memberId}`),
      ]);
      setCreds(c.credentials || []);
      setSchedules(s.schedules || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [memberId]);

  const issuePin = async () => {
    setBusy(true); setMsg(''); setNewPin('');
    try {
      const r = await api.post('/access-credentials/issue-pin', { memberId });
      setNewPin(r.pin || '');
      setMsg('PIN issue ho gaya — abhi copy kar lein, dobara nahi dikhega.');
      await load();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const revoke = async (id) => {
    if (!window.confirm('Is credential ko revoke karein?')) return;
    setBusy(true); setMsg('');
    try { await api.patch(`/access-credentials/${id}/revoke`, {}); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} />}
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900">🔑 Access Credentials ({creds.length})</h3>
        <button onClick={issuePin} disabled={busy}
          className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-gray-900 disabled:opacity-50">
          {busy ? '…' : '+ Issue PIN'}
        </button>
      </div>
      {newPin && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
          <div className="text-[11px] text-amber-700/70">Naya PIN (ek dafa):</div>
          <div className="text-2xl font-mono font-bold text-amber-700 tracking-widest">{newPin}</div>
        </div>
      )}
      {msg && <p className="text-xs text-blue-700 mb-2">{msg}</p>}
      <DataTable
        columns={[
          { key: 'type', label: 'Type', render: (c) => <Badge tone={TYPE_TONE[c.type] || 'slate'}>{c.type?.toUpperCase()}</Badge> },
          { key: 'isActive', label: 'Status', render: (c) => c.isActive ? <Badge tone="emerald">Active</Badge> : <Badge tone="slate">Revoked</Badge> },
          { key: 'expiresAt', label: 'Expires', render: (c) => c.expiresAt ? String(c.expiresAt).slice(0, 10) : '—' },
          { key: 'lastUsedAt', label: 'Last used', render: (c) => c.lastUsedAt ? String(c.lastUsedAt).slice(0, 16).replace('T', ' ') : '—' },
          {
            key: 'actions', label: 'Actions',
            render: (c) => c.isActive
              ? <button onClick={() => revoke(c.id)} className="text-xs font-semibold text-rose-700 hover:text-rose-700">Revoke</button>
              : <span className="text-xs text-gray-900/30">—</span>,
          },
        ]}
        rows={creds}
        empty={{ title: 'No credentials', hint: 'Issue a PIN to give this member door access.' }}
      />
      <h3 className="font-semibold text-gray-900 mb-2 mt-5">🕐 Access Schedules ({schedules.length})</h3>
      <DataTable
        columns={[
          { key: 'door', label: 'Door', render: (s) => s.door?.name || 'All doors' },
          { key: 'days', label: 'Days', render: (s) => (s.daysOfWeek || []).join(', ') || '—' },
          { key: 'time', label: 'Time', render: (s) => `${s.startTime || ''}–${s.endTime || ''}` },
          { key: 'isActive', label: 'Status', render: (s) => s.isActive ? <Badge tone="emerald">Active</Badge> : <Badge tone="slate">Off</Badge> },
        ]}
        rows={schedules}
        empty={{ title: 'No schedules', hint: 'Default building hours apply. Set per-member schedules from Access Desk.' }}
      />
    </div>
  );
}
