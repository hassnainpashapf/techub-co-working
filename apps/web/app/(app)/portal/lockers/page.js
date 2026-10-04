'use client';

// Phase 56 Track 8/10: Member Locker Portal — my lockers (code view, renewal, invoices),
// available lockers browse + request, waitlist join.
// Mount path: /portal/lockers (member portal; coordinator: Sidebar NAV_MEMBER me
//   { key: 'mylockers', label: 'Lockers', path: '/portal/lockers', icon: 'workspaces' } jorein).
// Backend contracts (sibling tracks abhi parallel ban rahe hain — coordinator verify/align karein):
//   GET  /api/locker-rentals/me                        — { rentals: [{id,status,startDate,endDate,monthlyRate,autoRenew,accessCode?,locker:{code,location,size,monthlyRate}}] }
//   POST /api/locker-rentals/me/:id/renew               — { rental } (renewal invoice samet)
//   PATCH /api/locker-rentals/me/:id { autoRenew }       — { rental }
//   GET  /api/lockers/available (?size=S|M|L|XL)         — { lockers: [{id,code,location,size,monthlyRate}] }
//   POST /api/locker-rentals/request { lockerId }       — 201 { rental } ya { request } (pending)
//   GET  /api/locker-waitlist/me                        — { entries: [{id,lockerId,size,createdAt,position?}] }
//   POST /api/locker-waitlist { lockerId?, size? }      — 201 { entry }
//   DELETE /api/locker-waitlist/:id                     — leave waitlist
// Locker invoices: existing /portal/invoices page par (locker marker se filter hotay hain).
// server.js/Sidebar.js untouched. Koi migration nahi. Deploy/push nahi — uncommitted.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../context/AuthContext';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal, Field } from '../../../../components/ui';

const STATUS_TONE = { active: 'green', expired: 'red', cancelled: 'slate', pending: 'amber' };
const SIZE_LABEL = { S: 'Chhota (S)', M: 'Medium (M)', L: 'Bara (L)', XL: 'Extra Bara (XL)' };
const SIZES = ['all', 'S', 'M', 'L', 'XL'];

function arr(d, key) {
  if (Array.isArray(d?.[key])) return d[key];
  return Array.isArray(d) ? d : [];
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMoney(p) {
  if (p === null || p === undefined || p === '') return '—';
  const n = Number(p);
  return Number.isFinite(n) ? `PKR ${n.toLocaleString('en-PK')}/mah` : String(p);
}

function MaskedCode({ code }) {
  const [show, setShow] = useState(false);
  if (!code) return <span className="text-slate-500 text-sm">Reception se PIN lein</span>;
  return (
    <button
      type="button"
      onClick={() => setShow((v) => !v)}
      className="font-mono text-lg tracking-[0.3em] bg-slate-800 border border-slate-700 rounded px-4 py-2 text-cyan-300 hover:border-cyan-500 transition"
      title={show ? 'Chhupayein' : 'Dekhne ke liye tap karein'}
    >
      {show ? code : '••••'}
    </button>
  );
}

export default function PortalLockersPage() {
  const { user } = useAuth();
  const [rentals, setRentals] = useState([]);
  const [available, setAvailable] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('mine'); // mine | available | waitlist
  const [sizeFilter, setSizeFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [wlForm, setWlForm] = useState({ lockerId: '', size: 'M' });
  const [showWlForm, setShowWlForm] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.allSettled([
      api.get('/locker-rentals/me'),
      api.get('/lockers/available' + (sizeFilter === 'all' ? '' : `?size=${sizeFilter}`)),
      api.get('/locker-waitlist/me'),
    ]).then(([r, a, w]) => {
      if (r.status === 'fulfilled') setRentals(arr(r.value, 'rentals'));
      else setError(r.reason?.message || 'Rentals load nahi huay');
      if (a.status === 'fulfilled') setAvailable(arr(a.value, 'lockers'));
      if (w.status === 'fulfilled') setWaitlist(arr(w.value, 'entries'));
      setLoading(false);
    });
  };
  useEffect(load, [sizeFilter]);

  const doAction = async (label, fn) => {
    setBusy(label);
    setMsg('');
    setError('');
    try {
      await fn();
      setMsg('Ho gaya ✓');
      load();
    } catch (e) {
      setError(e.message || 'Kuch ghalat hua');
    } finally {
      setBusy('');
    }
  };

  const renew = (id) => doAction(`renew-${id}`, () => api.post(`/locker-rentals/me/${id}/renew`));
  const toggleAuto = (id, cur) =>
    doAction(`auto-${id}`, () => api.patch(`/locker-rentals/me/${id}`, { autoRenew: !cur }));
  const requestLocker = (lockerId) =>
    doAction(`req-${lockerId}`, () => api.post('/locker-rentals/request', { lockerId }));
  const joinWaitlist = async (e) => {
    e.preventDefault();
    await doAction('wl-join', () =>
      api.post('/locker-waitlist', {
        lockerId: wlForm.lockerId || undefined,
        size: wlForm.size || undefined,
      })
    );
    setShowWlForm(false);
  };
  const leaveWaitlist = (id) => doAction(`wl-${id}`, () => api.del(`/locker-waitlist/${id}`));

  const activeRentals = rentals.filter((r) => r.status === 'active');
  const pastRentals = rentals.filter((r) => r.status !== 'active');

  return (
    <div className="p-6">
      <PageHeader
        title="🔐 Meray Lockers"
        subtitle="Locker access code, renewal aur invoices"
        actions={
          <Link href="/portal/invoices" className="btn-secondary">
            🧾 Invoices
          </Link>
        }
      />

      {error && <ErrorBanner message={error} />}
      {msg && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 rounded px-4 py-2 mb-4">{msg}</div>
      )}

      <div className="flex gap-2 mb-6">
        {[
          { k: 'mine', label: `📦 Meray (${activeRentals.length})` },
          { k: 'available', label: '🔍 Khali Lockers' },
          { k: 'waitlist', label: `⏳ Waitlist (${waitlist.length})` },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.k
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <>
          {tab === 'mine' && (
            <>
              {rentals.length === 0 ? (
                <EmptyState title="Koi locker nahi" message="Abhi aap ke paas koi locker rent par nahi hai. Khali lockers me se request karein." />
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {activeRentals.map((r) => (
                    <div key={r.id} className="bg-slate-900 border border-slate-700 rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="text-xl font-bold text-white">{r.locker?.code || '—'}</div>
                          <div className="text-sm text-slate-400">
                            {r.locker?.location || '—'} • {SIZE_LABEL[r.locker?.size] || r.locker?.size || ''}
                          </div>
                        </div>
                        <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status}</Badge>
                      </div>

                      <div className="mb-4">
                        <div className="text-xs text-slate-500 mb-1">ACCESS CODE</div>
                        <MaskedCode code={r.accessCode || r.pin} />
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                        <div className="text-slate-400">Start</div>
                        <div className="text-white text-right">{fmtDate(r.startDate)}</div>
                        <div className="text-slate-400">Khatam</div>
                        <div className="text-white text-right">{fmtDate(r.endDate)}</div>
                        <div className="text-slate-400">Mahana kiraya</div>
                        <div className="text-white text-right">{fmtMoney(r.monthlyRate ?? r.locker?.monthlyRate)}</div>
                        <div className="text-slate-400">Auto-renew</div>
                        <div className="text-right">
                          <button
                            onClick={() => toggleAuto(r.id, r.autoRenew)}
                            disabled={busy === `auto-${r.id}`}
                            className={`text-sm px-3 py-1 rounded ${
                              r.autoRenew ? 'bg-green-800 text-green-200' : 'bg-slate-700 text-slate-300'
                            }`}
                          >
                            {r.autoRenew ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => renew(r.id)}
                          disabled={busy === `renew-${r.id}`}
                          className="btn-primary flex-1"
                        >
                          {busy === `renew-${r.id}` ? '...' : '🔄 Renew karein'}
                        </button>
                        <Link href="/portal/invoices" className="btn-secondary">
                          🧾 Invoice
                        </Link>
                      </div>
                    </div>
                  ))}

                  {pastRentals.map((r) => (
                    <div key={r.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 opacity-80">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-lg font-bold text-slate-300">{r.locker?.code || '—'}</div>
                          <div className="text-xs text-slate-500">
                            {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                          </div>
                        </div>
                        <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'available' && (
            <>
              <div className="flex gap-2 mb-4">
                {SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSizeFilter(s)}
                    className={`px-3 py-1 rounded-full text-sm ${
                      sizeFilter === s ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {s === 'all' ? 'Sab' : s}
                  </button>
                ))}
              </div>
              {available.length === 0 ? (
                <EmptyState
                  title="Koi khali locker nahi"
                  message="Filhal koi khali locker nahi — waitlist me shamil ho jayein."
                  action={<button className="btn-primary mt-3" onClick={() => { setTab('waitlist'); setShowWlForm(true); }}>⏳ Waitlist join karein</button>}
                />
              ) : (
                <div className="grid md:grid-cols-3 gap-4">
                  {available.map((l) => (
                    <div key={l.id} className="bg-slate-900 border border-slate-700 rounded-xl p-5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xl font-bold text-white">{l.code}</div>
                        <Badge tone="green">Khali</Badge>
                      </div>
                      <div className="text-sm text-slate-400 mb-1">{l.location || '—'}</div>
                      <div className="text-sm text-slate-400 mb-3">{SIZE_LABEL[l.size] || l.size}</div>
                      <div className="text-cyan-300 font-semibold mb-4">{fmtMoney(l.monthlyRate)}</div>
                      <button
                        onClick={() => requestLocker(l.id)}
                        disabled={busy === `req-${l.id}`}
                        className="btn-primary w-full"
                      >
                        {busy === `req-${l.id}` ? '...' : '📝 Request karein'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'waitlist' && (
            <>
              <div className="flex justify-end mb-4">
                <button className="btn-primary" onClick={() => setShowWlForm(true)}>
                  + Waitlist join karein
                </button>
              </div>
              {waitlist.length === 0 ? (
                <EmptyState title="Waitlist khali" message="Aap kisi locker ki waitlist me nahi hain." />
              ) : (
                <div className="space-y-3">
                  {waitlist.map((w) => (
                    <div key={w.id} className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <div className="text-white font-semibold">
                          {w.lockerCode || w.lockerId || `Size: ${w.size || 'koi bhi'}`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {fmtDate(w.createdAt)}
                          {w.position ? ` • Position #${w.position}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => leaveWaitlist(w.id)}
                        disabled={busy === `wl-${w.id}`}
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        ❌ Niklein
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      <Modal open={showWlForm} onClose={() => setShowWlForm(false)} title="Waitlist join karein">
        <form onSubmit={joinWaitlist} className="space-y-4">
          <Field label="Locker (optional)">
            <select
              value={wlForm.lockerId}
              onChange={(e) => setWlForm({ ...wlForm, lockerId: e.target.value })}
              className="input"
            >
              <option value="">Koi bhi locker</option>
              {available.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {SIZE_LABEL[l.size] || l.size}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pasandeeda size">
            <select
              value={wlForm.size}
              onChange={(e) => setWlForm({ ...wlForm, size: e.target.value })}
              className="input"
            >
              {['S', 'M', 'L', 'XL'].map((s) => (
                <option key={s} value={s}>{SIZE_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <button type="submit" disabled={busy === 'wl-join'} className="btn-primary w-full">
            {busy === 'wl-join' ? '...' : '⏳ Join karein'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
