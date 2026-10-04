'use client';

// Phase 48 Track 9: Reception Access Desk.
// Mount (coordinator server.js me ADD karein — routes track 1-6/8 se aate hain):
//   app.use('/api/doors', require('./routes/doors'));
//   app.use('/api/access-credentials', require('./routes/access-credentials'));
//   app.use('/api/access-schedules', require('./routes/access-schedules'));
//   app.use('/api/access-logs', require('./routes/access-logs'));
//   app.use('/api/day-passes', require('./routes/day-passes'));
// Sidebar link (coordinator): { label: 'Access Desk', path: '/access/desk' }
//   — Access section me, roles: receptionist/ops/manager/admin/ceo/super_admin
//
// Reused endpoints (sibling tracks):
//   GET    /api/members?search=
//   GET    /api/doors
//   GET    /api/access-credentials?memberId=
//   POST   /api/access-credentials/issue-pin { memberId, expiresAt? } -> { pin } (ek dafa plain)
//   PATCH  /api/access-credentials/:id/revoke
//   POST   /api/access-schedules { memberId, doorId?, daysOfWeek, startTime, endTime, isActive? }
//   POST   /api/access-logs/manual { memberId, doorId, direction }
//   GET    /api/day-passes?status=pending
//   PATCH  /api/day-passes/:id { status: 'active' | 'revoked' }
// Koi backend route maine nahi banaya — sab existing/sibling routes reuse.

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import {
  PageHeader, DataTable, Badge, Modal, Field, Spinner, ErrorBanner,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const DESK_ROLES = ['receptionist', 'ops', 'manager', 'admin', 'ceo', 'super_admin'];
const DAYS = [
  { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' }, { v: 4, l: 'Thu' },
  { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 7, l: 'Sun' },
];

function blockedReason(member) {
  if (!member) return null;
  if (member.status && !['active'].includes(member.status)) return `Member status: ${member.status}`;
  return null;
}

export default function AccessDeskPage() {
  const { allowed, checking } = useRequireRoles(DESK_ROLES);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [member, setMember] = useState(null);
  const [creds, setCreds] = useState([]);
  const [doors, setDoors] = useState([]);
  const [passes, setPasses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [pinModal, setPinModal] = useState(null); // { pin, memberName }
  const [schedForm, setSchedForm] = useState({ doorId: '', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' });
  const [entryForm, setEntryForm] = useState({ doorId: '', direction: 'in' });

  useEffect(() => {
    if (!allowed) return;
    api.get('/api/doors').then((d) => setDoors(d?.doors || d || [])).catch(() => {});
    loadPasses();
  }, [allowed]);

  async function loadPasses() {
    try {
      const d = await api.get('/api/day-passes?status=pending');
      setPasses(d?.passes || d || []);
    } catch { /* track 5 merge pending — chup */ }
  }

  async function search() {
    if (!q.trim()) return;
    setSearching(true); setErr('');
    try {
      const d = await api.get(`/api/members?search=${encodeURIComponent(q.trim())}`);
      setResults(d?.members || d?.data || d || []);
    } catch (e) { setErr(e.message || 'Search failed'); }
    finally { setSearching(false); }
  }

  async function pick(m) {
    setMember(m); setMsg(''); setErr(''); setLoading(true);
    try {
      const [c, s] = await Promise.allSettled([
        api.get(`/api/access-credentials?memberId=${m.id}`),
        api.get(`/api/access-schedules?memberId=${m.id}`),
      ]);
      setCreds(c.status === 'fulfilled' ? (c.value?.credentials || c.value || []) : []);
      setSchedules(s.status === 'fulfilled' ? (s.value?.schedules || s.value || []) : []);
      if (c.status === 'rejected' && String(c.reason?.message || '').includes('503')) {
        setErr('Access modules abhi merge nahi hue — coordinator ke baad dobara try karein.');
      }
    } finally { setLoading(false); }
  }

  async function issuePin() {
    setMsg(''); setErr('');
    try {
      const d = await api.post('/api/access-credentials/issue-pin', { memberId: member.id });
      setPinModal({ pin: d.pin, memberName: member.name });
      pick(member);
      setMsg('PIN issue ho gaya — neeche ek dafa dikhaya gaya hai, dobara nahi milega.');
    } catch (e) { setErr(e.message || 'PIN issue failed'); }
  }

  async function revokeCred(id) {
    if (!confirm('Is credential ko revoke karein?')) return;
    try {
      await api.patch(`/api/access-credentials/${id}/revoke`);
      setMsg('Credential revoked.');
      pick(member);
    } catch (e) { setErr(e.message || 'Revoke failed'); }
  }

  async function saveSchedule() {
    setMsg(''); setErr('');
    try {
      await api.post('/api/access-schedules', {
        memberId: member.id,
        doorId: schedForm.doorId || null,
        daysOfWeek: schedForm.days,
        startTime: schedForm.startTime,
        endTime: schedForm.endTime,
        isActive: true,
      });
      setMsg('Schedule save ho gaya.');
      pick(member);
    } catch (e) { setErr(e.message || 'Schedule save failed'); }
  }

  async function logEntry() {
    if (!entryForm.doorId) { setErr('Door select karein.'); return; }
    setMsg(''); setErr('');
    try {
      await api.post('/api/access-logs/manual', {
        memberId: member.id, doorId: entryForm.doorId, direction: entryForm.direction,
      });
      setMsg(`Manual entry logged (${entryForm.direction === 'in' ? 'andar' : 'bahar'}).`);
    } catch (e) { setErr(e.message || 'Entry log failed'); }
  }

  async function decidePass(id, ok) {
    try {
      await api.patch(`/api/day-passes/${id}`, { status: ok ? 'active' : 'revoked' });
      setMsg(ok ? 'Pass approve ho gaya.' : 'Pass reject ho gaya.');
      loadPasses();
    } catch (e) { setErr(e.message || 'Pass update failed'); }
  }

  function toggleDay(v) {
    setSchedForm((f) => ({ ...f, days: f.days.includes(v) ? f.days.filter((d) => d !== v) : [...f.days, v].sort() }));
  }

  if (checking) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const blocked = blockedReason(member);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="🛎️ Access Desk" sub="Reception — member access, PIN, schedules, manual entry, visitor passes" />

      {err && <ErrorBanner message={err} />}
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-700 text-sm">{msg}</div>}

      {/* Member search */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex gap-2">
          <Field label="Member search (naam / email / phone)">
            <input
              className="input-premium" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Ali Raza…" />
          </Field>
          <div className="flex items-end">
            <button className="btn-primary" onClick={search} disabled={searching}>{searching ? '…' : 'Search'}</button>
          </div>
        </div>
        {results.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {results.slice(0, 9).map((m) => (
              <button key={m.id} onClick={() => pick(m)}
                className={`text-left rounded-lg border p-3 transition ${member?.id === m.id ? 'border-[#0f766e]/50 bg-[#0f766e]/10' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="font-medium text-gray-900">{m.name}</div>
                <div className="text-xs text-gray-500">{m.email || m.phone || ''}</div>
                <Badge tone={m.status === 'active' ? 'green' : 'red'}>{m.status || 'unknown'}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <Spinner />}

      {member && !loading && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Access status + credentials */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{member.name} — access status</h3>
              {blocked
                ? <Badge tone="red">🚫 Blocked</Badge>
                : <Badge tone="green">✅ Active</Badge>}
            </div>
            {blocked && <div className="text-sm text-red-700">{blocked}</div>}

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600 font-medium">🔑 Credentials</span>
                <button className="btn-secondary text-sm" onClick={issuePin}>+ PIN issue karein</button>
              </div>
              {creds.length === 0
                ? <div className="text-sm text-slate-500">Koi credential nahi.</div>
                : (
                  <div className="space-y-2">
                    {creds.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                        <div className="text-sm">
                          <span className="text-gray-900 font-medium uppercase">{c.type}</span>
                          <span className="text-gray-500 text-xs ml-2">
                            {c.lastUsedAt ? `last used ${new Date(c.lastUsedAt).toLocaleString()}` : 'kabhi use nahi hua'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'active' : 'revoked'}</Badge>
                          {c.isActive && (
                            <button className="text-xs text-red-700 hover:text-red-700" onClick={() => revokeCred(c.id)}>Revoke</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {/* Manual entry */}
            <div className="border-t border-gray-200 pt-4">
              <h4 className="text-sm font-medium text-gray-600 mb-2">📝 Manual entry log</h4>
              <div className="flex gap-2">
                <Field label="Door">
                  <select className="input-premium" value={entryForm.doorId} onChange={(e) => setEntryForm({ ...entryForm, doorId: e.target.value })}>
                    <option value="">—</option>
                    {doors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Direction">
                  <select className="input-premium" value={entryForm.direction} onChange={(e) => setEntryForm({ ...entryForm, direction: e.target.value })}>
                    <option value="in">Andar (in)</option>
                    <option value="out">Bahar (out)</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <button className="btn-primary" onClick={logEntry}>Log</button>
                </div>
              </div>
            </div>
          </div>

          {/* Schedule */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
            <h3 className="font-semibold text-gray-900">🕒 Access schedule</h3>
            {schedules.length > 0 && (
              <div className="space-y-2">
                {schedules.map((s) => (
                  <div key={s.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600">
                    {(s.doorName || 'All doors')} — {(s.daysOfWeek || []).join(', ')} {s.startTime}–{s.endTime}
                    {!s.isActive && <Badge tone="slate" className="ml-2">off</Badge>}
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-3">
              <Field label="Door (khali = sab doors)">
                <select className="input-premium" value={schedForm.doorId} onChange={(e) => setSchedForm({ ...schedForm, doorId: e.target.value })}>
                  <option value="">All doors</option>
                  {doors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <div>
                <div className="text-sm text-gray-500 mb-1">Din</div>
                <div className="flex gap-1 flex-wrap">
                  {DAYS.map((d) => (
                    <button key={d.v} onClick={() => toggleDay(d.v)}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${schedForm.days.includes(d.v) ? 'border-[#0f766e]/60 bg-[#0f766e]/20 text-blue-100' : 'border-gray-200 text-gray-500'}`}>
                      {d.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Field label="Start"><input type="time" className="input-premium" value={schedForm.startTime} onChange={(e) => setSchedForm({ ...schedForm, startTime: e.target.value })} /></Field>
                <Field label="End"><input type="time" className="input-premium" value={schedForm.endTime} onChange={(e) => setSchedForm({ ...schedForm, endTime: e.target.value })} /></Field>
              </div>
              <button className="btn-primary" onClick={saveSchedule}>Schedule save karein</button>
            </div>
          </div>
        </div>
      )}

      {/* Pending visitor passes */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">🎫 Pending visitor passes {passes.length > 0 && <Badge tone="amber">{passes.length}</Badge>}</h3>
          <button className="text-sm text-gray-600 hover:text-gray-900" onClick={loadPasses}>↻ Refresh</button>
        </div>
        {passes.length === 0
          ? <div className="text-sm text-slate-500">Koi pending request nahi.</div>
          : (
            <DataTable
              columns={[
                { key: 'visitorName', label: 'Visitor' },
                { key: 'host', label: 'Host', render: (p) => p.hostName || p.hostMemberName || '—' },
                { key: 'validUntil', label: 'Valid tak', render: (p) => p.validUntil ? new Date(p.validUntil).toLocaleString() : '—' },
                {
                  key: 'actions', label: 'Action', render: (p) => (
                    <div className="flex gap-2">
                      <button className="btn-primary text-xs" onClick={() => decidePass(p.id, true)}>Approve</button>
                      <button className="text-xs text-red-700 hover:text-red-700" onClick={() => decidePass(p.id, false)}>Reject</button>
                    </div>
                  ),
                },
              ]}
              rows={passes}
            />
          )}
      </div>

      {pinModal && (
        <Modal title="🔑 Naya PIN" onClose={() => setPinModal(null)}>
          <p className="text-sm text-gray-600 mb-3">
            {pinModal.memberName} ka PIN <b className="text-gray-900">sirf ek dafa</b> dikhaya ja raha hai — abhi note kar lein:
          </p>
          <div className="text-center text-4xl font-mono tracking-[0.5em] text-emerald-700 bg-black/40 rounded-lg py-4">
            {pinModal.pin}
          </div>
          <button className="btn-primary w-full mt-4" onClick={() => setPinModal(null)}>Ho gaya</button>
        </Modal>
      )}
    </div>
  );
}
