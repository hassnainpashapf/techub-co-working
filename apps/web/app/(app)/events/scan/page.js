'use client';

// Phase 44 Track 4: Event entry scanning.
// Staff reception par QR ticket code scan karta hai (manual input; camera optional nahi — manual input lazmi hai).
// Fast-scan mode: success par input auto-clear + auto-focus taake lagataar scan ho sake.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const SCAN_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops', 'operations_manager'];

export default function TicketScanPage() {
  const { allowed, checking } = useRequireRoles(SCAN_ROLES);
  const [code, setCode] = useState('');
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState([]);
  const [result, setResult] = useState(null); // {ok, valid, message, ticket, reason}
  const [scanning, setScanning] = useState(false);
  const [fastMode, setFastMode] = useState(true);
  const [stats, setStats] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { if (allowed) loadEvents(); }, [allowed]);
  useEffect(() => { if (allowed && eventId) loadStats(); }, [allowed, eventId]);

  async function loadEvents() {
    try {
      const r = await api.get('/api/events?status=upcoming,ongoing');
      const list = r.data?.events || r.data || [];
      setEvents(Array.isArray(list) ? list : []);
    } catch { /* optional filter */ }
  }

  async function loadStats() {
    if (!eventId) { setStats(null); return; }
    try {
      const r = await api.get(`/api/ticket-scan/stats/${eventId}`);
      setStats(r.data);
    } catch { /* 503 before migration */ }
  }

  async function validate(e) {
    e?.preventDefault();
    if (!code.trim() || scanning) return;
    setScanning(true);
    setResult(null);
    try {
      const r = await api.post('/api/ticket-scan/validate', { code: code.trim(), eventId: eventId || undefined });
      setResult({ ...r.data, time: new Date() });
      if (r.data?.valid) {
        if (fastMode) { setCode(''); }
        loadStats();
      }
    } catch (err) {
      const d = err.response?.data || {};
      setResult({ ok: false, valid: false, message: d.message || d.error || 'Scan failed', reason: d.reason, ticket: d.ticket, time: new Date() });
    } finally {
      setScanning(false);
      if (fastMode) inputRef.current?.focus();
    }
  }

  if (checking) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const res = result;
  const tone = !res ? null : res.valid ? 'green' : 'red';

  return (
    <div className="space-y-3">
      <PageHeader title="Ticket Scanning" subtitle="Event entry — QR ticket validate karo" />

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Scanned" value={stats.scanned} />
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Remaining" value={stats.remaining} />
          <StatCard label="Entry rate" value={`${stats.entryRate}%`} />
        </div>
      )}

      <div className="card p-5 space-y-3 max-w-xl">
        <Field label="Event (optional filter)">
          <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">— All events —</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
          </select>
        </Field>

        <form onSubmit={validate} className="flex gap-2">
          <input
            ref={inputRef}
            className="input flex-1 font-mono"
            placeholder="Ticket code paste/scan karo…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={scanning || !code.trim()}>
            {scanning ? 'Checking…' : 'Validate'}
          </button>
        </form>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={fastMode} onChange={(e) => setFastMode(e.target.checked)} />
          Fast-scan mode (success par input auto-clear)
        </label>

        {res && (
          <div className={`rounded-xl border p-4 ${tone === 'green' ? 'border-emerald-500/40 bg-emerald-50' : 'border-red-500/40 bg-red-50'}`}>
            <div className={`text-lg font-bold ${tone === 'green' ? 'text-emerald-700' : 'text-red-700'}`}>
              {res.valid ? '✅ Entry allowed' : '⛔ ' + (res.message || 'Invalid')}
            </div>
            {res.ticket && (
              <div className="mt-2 text-sm text-gray-600 space-y-1">
                <div>Name: <b>{res.ticket.buyerName}</b></div>
                {res.ticket.ticketType && <div>Ticket: {res.ticket.ticketType.name}</div>}
                {res.ticket.event && <div>Event: {res.ticket.event.title}</div>}
                {res.ticket.usedAt && <div>Used at: {new Date(res.ticket.usedAt).toLocaleString()}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
