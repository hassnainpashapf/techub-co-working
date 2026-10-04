'use client';

// Phase 37 Track 9: Reception check-in desk — tablet-friendly quick desk for
// receptionists: member search + check-in/out, QR scan, visitor walk-in,
// and a live "who's in" board.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../context/AuthContext';
import {
  PageHeader,
  Badge,
  Field,
  Spinner,
  ErrorBanner,
  EmptyState,
  StatCard,
} from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const DESK_ROLES = ['receptionist', 'manager', 'operations_manager', 'admin', 'ceo'];

const PURPOSES = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'tour', label: 'Tour' },
  { value: 'interview', label: 'Interview' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'other', label: 'Other' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReceptionCheckinPage() {
  const { allowed, user } = useRequireRoles(...DESK_ROLES);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // member search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyMember, setBusyMember] = useState(null); // memberId currently acting on
  const [checkedInIds, setCheckedInIds] = useState({}); // memberId -> true (local state)

  // QR
  const [qrToken, setQrToken] = useState('');
  const [qrBusy, setQrBusy] = useState(false);

  // visitor walk-in
  const [visitor, setVisitor] = useState({ name: '', phone: '', purpose: 'meeting', hostName: '', notes: '' });
  const [visitorBusy, setVisitorBusy] = useState(false);

  // who's in
  const [insideMembers, setInsideMembers] = useState([]);
  const [insideVisitors, setInsideVisitors] = useState([]);
  const [boardLoading, setBoardLoading] = useState(true);

  const loadBoard = useCallback(async () => {
    try {
      const [recs, vis] = await Promise.all([
        api.get(`/attendance/records?date=${todayStr()}`),
        api.get('/visitors?today=true&inside=true'),
      ]);
      const records = recs.records || [];
      setInsideMembers(records.filter((r) => r.checkIn && !r.checkOut));
      setInsideVisitors(vis.visitors || []);
      setBoardLoading(false);
    } catch (e) {
      setBoardLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) {
      loadBoard();
      const t = setInterval(loadBoard, 30000);
      return () => clearInterval(t);
    }
  }, [allowed, loadBoard]);

  async function searchMembers(e) {
    e?.preventDefault?.();
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await api.get(`/members?search=${encodeURIComponent(query.trim())}`);
      setResults(res.members || []);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSearching(false);
    }
  }

  async function memberAction(member, action) {
    setBusyMember(member.id);
    setError('');
    setNotice('');
    try {
      const res = await api.post(`/member-qr/manual-${action}`, { memberId: member.id });
      if (action === 'check-in') {
        setCheckedInIds((s) => ({ ...s, [member.id]: true }));
        setNotice(
          res.alreadyCheckedIn
            ? `${res.member?.name || member.name} is already checked in.`
            : `${res.member?.name || member.name} checked in.`
        );
      } else {
        setCheckedInIds((s) => ({ ...s, [member.id]: false }));
        setNotice(
          res.alreadyCheckedOut
            ? `${res.member?.name || member.name} is already checked out.`
            : `${res.member?.name || member.name} checked out.`
        );
      }
      loadBoard();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusyMember(null);
    }
  }

  async function scanQr(e) {
    e?.preventDefault?.();
    if (!qrToken.trim()) return;
    setQrBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.post('/member-qr/scan', { token: qrToken.trim() });
      setNotice(
        res.alreadyCheckedIn
          ? `${res.member?.name} is already checked in.`
          : `${res.member?.name} checked in via QR.`
      );
      setQrToken('');
      loadBoard();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setQrBusy(false);
    }
  }

  async function walkInVisitor(e) {
    e.preventDefault();
    if (!visitor.name.trim()) {
      setError('Visitor name is required.');
      return;
    }
    setVisitorBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.post('/visitors/check-in', {
        name: visitor.name.trim(),
        phone: visitor.phone.trim() || undefined,
        purpose: visitor.purpose,
        hostName: visitor.hostName.trim() || undefined,
        notes: visitor.notes.trim() || undefined,
      });
      setNotice(`Visitor ${res.visitor?.name} checked in.`);
      setVisitor({ name: '', phone: '', purpose: 'meeting', hostName: '', notes: '' });
      loadBoard();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setVisitorBusy(false);
    }
  }

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f5f7]">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!allowed) return <AccessDenied />;

  return (
    <div>
      <PageHeader title="Reception Desk" sub="Quick check-in desk — members, QR codes and walk-in visitors." />

      {error && <ErrorBanner message={error} onRetry={() => setError('')} />}
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Member search + check-in/out */}
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Member check-in</h3>
          <p className="text-sm text-gray-500 mb-4">Search by name or phone, then tap a button.</p>
          <form onSubmit={searchMembers} className="flex gap-2 mb-4">
            <input
              className="input flex-1 text-lg py-3"
              placeholder="Type name or phone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-primary px-6 py-3 text-lg" disabled={searching}>
              {searching ? '…' : 'Search'}
            </button>
          </form>
          {results.length === 0 && !searching && (
            <EmptyState title="No results yet" hint="Search for a member above." />
          )}
          <div className="space-y-3">
            {results.map((m) => {
              const inNow = checkedInIds[m.id];
              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-gray-200/60 bg-gray-100/40 p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{m.name}</div>
                    <div className="text-sm text-gray-500 truncate">
                      {[m.phone, m.companyName].filter(Boolean).join(' · ')}
                    </div>
                    {inNow === true && <Badge tone="green">Checked in</Badge>}
                    {inNow === false && <Badge tone="slate">Checked out</Badge>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      className="btn bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-3 text-base font-semibold"
                      disabled={busyMember === m.id}
                      onClick={() => memberAction(m, 'check-in')}
                    >
                      {busyMember === m.id ? '…' : 'Check in'}
                    </button>
                    <button
                      className="btn bg-amber-600 hover:bg-amber-500 text-white px-5 py-3 text-base font-semibold"
                      disabled={busyMember === m.id}
                      onClick={() => memberAction(m, 'check-out')}
                    >
                      {busyMember === m.id ? '…' : 'Check out'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* QR + visitor walk-in */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Scan member QR</h3>
            <p className="text-sm text-gray-500 mb-4">
              Paste the token from the member's digital ID card (camera scan coming soon).
            </p>
            <form onSubmit={scanQr} className="flex gap-2">
              <input
                className="input flex-1 py-3 font-mono text-sm"
                placeholder="Paste QR token…"
                value={qrToken}
                onChange={(e) => setQrToken(e.target.value)}
              />
              <button type="submit" className="btn btn-primary px-6 py-3 text-base" disabled={qrBusy}>
                {qrBusy ? '…' : 'Verify & check in'}
              </button>
            </form>
          </div>

          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Visitor walk-in</h3>
            <p className="text-sm text-gray-500 mb-4">Quick check-in for visitors without an invite.</p>
            <form onSubmit={walkInVisitor} className="space-y-3">
              <Field label="Name *">
                <input
                  className="input w-full py-3 text-lg"
                  value={visitor.name}
                  onChange={(e) => setVisitor((v) => ({ ...v, name: e.target.value }))}
                  placeholder="Visitor full name"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <input
                    className="input w-full py-3"
                    value={visitor.phone}
                    onChange={(e) => setVisitor((v) => ({ ...v, phone: e.target.value }))}
                    placeholder="03xx-xxxxxxx"
                  />
                </Field>
                <Field label="Purpose">
                  <select
                    className="input w-full py-3"
                    value={visitor.purpose}
                    onChange={(e) => setVisitor((v) => ({ ...v, purpose: e.target.value }))}
                  >
                    {PURPOSES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Host (optional)">
                <input
                  className="input w-full py-3"
                  value={visitor.hostName}
                  onChange={(e) => setVisitor((v) => ({ ...v, hostName: e.target.value }))}
                  placeholder="Who are they visiting?"
                />
              </Field>
              <button
                type="submit"
                className="btn btn-primary w-full py-4 text-lg font-semibold"
                disabled={visitorBusy}
              >
                {visitorBusy ? 'Checking in…' : 'Check in visitor'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Who's in */}
      <div className="mt-4">
        <div className="grid gap-4 sm:grid-cols-2 mb-4">
          <StatCard label="Members inside" value={insideMembers.length} accent="green" icon="👥" />
          <StatCard label="Visitors inside" value={insideVisitors.length} accent="blue" icon="🧳" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">Members inside</h3>
              <button className="btn btn-ghost btn-sm" onClick={loadBoard}>
                Refresh
              </button>
            </div>
            {boardLoading ? (
              <Spinner />
            ) : insideMembers.length === 0 ? (
              <EmptyState title="Nobody checked in" hint="Members you check in will appear here." />
            ) : (
              <ul className="space-y-2 max-h-72 overflow-auto">
                {insideMembers.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200/60 bg-gray-100/40 px-3 py-2"
                  >
                    <span className="text-sm text-gray-900 font-medium">{r.user?.name || '—'}</span>
                    <span className="text-xs text-gray-500">
                      in {r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Visitors inside</h3>
            {boardLoading ? (
              <Spinner />
            ) : insideVisitors.length === 0 ? (
              <EmptyState title="No visitors inside" hint="Walk-in visitors will appear here." />
            ) : (
              <ul className="space-y-2 max-h-72 overflow-auto">
                {insideVisitors.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200/60 bg-gray-100/40 px-3 py-2"
                  >
                    <div>
                      <div className="text-sm text-gray-900 font-medium">{v.name}</div>
                      <div className="text-xs text-gray-500">
                        {[v.purpose, v.hostName || v.hostMember?.name].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        setError('');
                        try {
                          await api.post(`/visitors/${v.id}/check-out`);
                          loadBoard();
                        } catch (e2) {
                          setError(e2.message);
                        }
                      }}
                    >
                      Check out
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
