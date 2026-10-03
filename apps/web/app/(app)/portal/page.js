'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../components/ui';
import SurveyBanner from '../../../components/SurveyBanner';
import MailBanner from '../../../components/MailBanner';
import AiAssistant from './_components/AiAssistant';

function fmtMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString()}`;
}

function fmtDateTime(s) {
  return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDate(s) {
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// Book-a-space modal (member creates own booking via portal API)
function PortalBookingModal({ onClose, onDone }) {
  const [units, setUnits] = useState([]);
  const [unitId, setUnitId] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('12:00');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/spaces/units').then((d) => setUnits(d.units || [])).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const unit = units.find((u) => u.id === unitId);
      await api.post('/portal/bookings', {
        unitId,
        title: title || `Booking — ${unit?.code || 'space'}`,
        startAt: `${date}T${startTime}:00`,
        endAt: `${date}T${endTime}:00`,
      });
      onDone();
    } catch (err) {
      setError(err.message || 'Booking failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="Book a Space" onClose={onClose}>
      <form onSubmit={submit}>
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
        )}
        <Field label="Space">
          <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
            <option value="">— Select —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.code} — {u.type}</option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Team meeting" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <input type="date" className="input [color-scheme:dark]" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Start">
            <input type="time" className="input [color-scheme:dark]" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </Field>
          <Field label="End">
            <input type="time" className="input [color-scheme:dark]" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Booking…' : 'Confirm Booking'}</button>
        </div>
      </form>
    </Modal>
  );
}

// Invite-a-visitor modal — member pre-registers own visitor (phase 33 API)
function VisitorInviteModal({ onClose, onDone }) {
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('10:00');
  const [purpose, setPurpose] = useState('meeting');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api.post('/visitor-invites', {
        visitorName,
        visitorPhone: visitorPhone || null,
        expectedAt: `${date}T${time}:00`,
        purpose,
      });
      setCode(d.invite?.code || '');
      setBusy(false);
    } catch (err) {
      setError(err.message || 'Invite failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="Invite a Visitor" onClose={onClose}>
      {code ? (
        <div className="text-center py-4">
          <p className="text-emerald-300 font-bold text-lg mb-2">✓ Invite created</p>
          <p className="text-slate-400 text-sm mb-3">Share this code with your visitor for fast check-in at reception:</p>
          <p className="text-3xl font-mono font-bold tracking-widest text-white bg-white/[0.04] border border-white/10 rounded-xl py-4 mb-4">{code}</p>
          <button onClick={onDone} className="btn-primary">Done</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
          )}
          <Field label="Visitor name">
            <input className="input" value={visitorName} onChange={(e) => setVisitorName(e.target.value)} required placeholder="Guest name" />
          </Field>
          <Field label="Visitor phone (optional)">
            <input className="input" value={visitorPhone} onChange={(e) => setVisitorPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">
              <input type="date" className="input [color-scheme:dark]" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Time">
              <input type="time" className="input [color-scheme:dark]" value={time} onChange={(e) => setTime(e.target.value)} required />
            </Field>
            <Field label="Purpose">
              <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="meeting">Meeting</option>
                <option value="tour">Tour</option>
                <option value="interview">Interview</option>
                <option value="delivery">Delivery</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Creating…' : 'Create Invite'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Announcements feed (phase 33) — pinned first, unread highlighted, latest 3 preview
function AnnouncementsFeed() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [showAll, setShowAll] = useState(false);

  const load = () => {
    api.get('/announcements/feed?limit=10')
      .then((d) => setItems(d.announcements || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggle = async (id) => {
    const open = !expanded[id];
    setExpanded({ ...expanded, [id]: open });
    if (open) {
      try {
        await api.post(`/announcements/${id}/read`);
        setItems((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
      } catch { /* ignore */ }
    }
  };

  const unread = items.filter((a) => !a.read).length;
  const visible = showAll ? items : items.slice(0, 3);

  return (
    <div className="card-premium p-5 mt-6" id="announcements">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-bold">📢 Announcements</h2>
        {unread > 0 && <span className="text-xs font-bold bg-blue-500/20 border border-blue-400/40 text-blue-200 rounded-full px-2.5 py-0.5">{unread} new</span>}
      </div>
      {loading ? <Spinner /> : items.length === 0 ? (
        <p className="text-slate-400 text-sm">No announcements right now.</p>
      ) : (
        <>
          <div className="space-y-3">
            {visible.map((a) => (
              <button
                key={a.id}
                onClick={() => toggle(a.id)}
                className={`w-full text-left rounded-xl px-4 py-3 border transition ${
                  a.pinned
                    ? 'bg-violet-500/[0.08] border-violet-400/40 shadow-[0_0_20px_rgba(139,92,246,0.12)]'
                    : 'bg-white/[0.03] border-white/[0.06] hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-2">
                  {!a.read && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />}
                  {a.pinned && <span className="text-xs">📌</span>}
                  <p className="text-white font-medium text-sm flex-1">{a.title}</p>
                  <span className="text-slate-500 text-xs shrink-0">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
                {expanded[a.id] && (
                  <p className="text-slate-300 text-sm mt-2 whitespace-pre-wrap">{a.body}</p>
                )}
                {a.senderName && (
                  <p className="text-slate-500 text-xs mt-1">— {a.senderName}</p>
                )}
              </button>
            ))}
          </div>
          {items.length > 3 && (
            <button onClick={() => setShowAll(!showAll)} className="text-sm text-blue-300 hover:text-blue-200 underline mt-3">
              {showAll ? 'Show less' : `View all ${items.length} →`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Phase 33 Track 5: Directory profile — member's own opt-in presence settings
function DirectoryProfileSection() {
  const [profile, setProfile] = useState(null);
  const [optIn, setOptIn] = useState(false);
  const [bio, setBio] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/directory/my-profile')
      .then((d) => {
        const p = d.profile || {};
        setProfile(p);
        setOptIn(!!p.directoryOptIn);
        setBio(p.directoryBio || '');
        setTagsInput((p.directoryTags || []).join(', '));
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      const d = await api.put('/directory/my-profile', { directoryOptIn: optIn, directoryBio: bio || null, directoryTags: tags });
      setProfile(d.profile);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-premium p-5 mt-6">
      <h2 className="text-white font-bold mb-1">Directory Profile 🤝</h2>
      <p className="text-slate-400 text-xs mb-4">Opt in to appear in the member directory. Only your name, company, bio and tags are shown — never email or phone.</p>
      <label className="flex items-center gap-3 mb-4 cursor-pointer">
        <button
          type="button"
          role="switch"
          aria-checked={optIn}
          onClick={() => setOptIn(!optIn)}
          className={`w-11 h-6 rounded-full relative transition-colors ${optIn ? 'bg-blue-500' : 'bg-white/10'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${optIn ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <span className="text-sm text-white font-medium">Show me in the member directory</span>
      </label>
      {optIn && (
        <>
          <div className="mb-3">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Bio</label>
            <textarea
              className="input"
              rows={2}
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What do you do? What are you looking for?"
            />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Tags (comma separated)</label>
            <input
              className="input"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="design, marketing, startup"
            />
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-300 mb-3">{error}</p>}
      {saved && <p className="text-sm text-emerald-300 mb-3">Saved ✓</p>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save'}</button>
        <a href="/portal/directory" className="text-sm text-blue-300 hover:text-blue-200 underline">View directory →</a>
      </div>
    </div>
  );
}

// iCal feed section — subscribe to upcoming bookings from any calendar app.
function CalendarFeedSection() {
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [regen, setRegen] = useState(false);

  const load = async () => {
    try {
      const d = await api.get('/ical/my');
      setFeed(d);
    } catch {
      setFeed(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api\/?$/, '');
  const feedUrl = feed ? `${base}/api${feed.path}` : '';
  const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://');
  const googleUrl = feedUrl ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl)}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const regenerate = async () => {
    if (!confirm('Get a new calendar link? The old link will stop working.')) return;
    setRegen(true);
    try {
      const d = await api.post('/ical/regenerate');
      setFeed(d);
    } finally {
      setRegen(false);
    }
  };

  return (
    <div className="card-premium p-5 mt-6">
      <h2 className="text-white font-bold mb-1">📅 Add to Calendar</h2>
      <p className="text-slate-400 text-sm mb-4">Subscribe to your upcoming bookings in Google, Apple or Outlook calendar. The feed updates automatically.</p>
      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : !feed ? (
        <p className="text-slate-500 text-sm">Calendar feed unavailable.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2">
            <code className="flex-1 text-xs text-slate-300 truncate">{feedUrl}</code>
            <button onClick={copy} className="text-xs text-blue-300 hover:text-blue-200 border border-blue-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap">
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={googleUrl} target="_blank" rel="noreferrer" className="text-xs text-white bg-blue-600/80 hover:bg-blue-600 rounded-lg px-3 py-1.5">Add to Google Calendar</a>
            <a href={webcalUrl} className="text-xs text-white bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg px-3 py-1.5">Subscribe (Apple / Outlook)</a>
            <button onClick={regenerate} disabled={regen} className="text-xs text-slate-400 hover:text-slate-200 underline">
              {regen ? '…' : 'Get new link'}
            </button>
          </div>
          <p className="text-slate-500 text-xs">Keep this link private — anyone with it can see your upcoming bookings.</p>
        </div>
      )}
    </div>
  );
}

// Next-booking card with member self check-in
function NextBookingCard({ booking, onCheckIn, checkingIn }) {
  if (!booking) {
    return (
      <div className="card-premium p-5">
        <h2 className="text-white font-bold mb-2">📅 Next Booking</h2>
        <p className="text-slate-400 text-sm">No upcoming bookings.</p>
      </div>
    );
  }
  const checkedIn = booking.status === 'checked_in';
  return (
    <div className="card-premium p-5 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-violet-500 to-blue-500" />
      <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider mb-1">Next booking</p>
      <h2 className="text-white font-bold text-lg">{booking.title}</h2>
      <p className="text-slate-300 text-sm mt-1">{booking.unit?.code} • {booking.unit?.type}</p>
      <p className="text-slate-400 text-sm">🕙 {fmtDateTime(booking.startAt)} → {new Date(booking.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
      <div className="mt-4">
        {checkedIn ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/40 rounded-lg px-4 py-2">
            ✓ Checked in
          </span>
        ) : (
          <button
            onClick={() => onCheckIn(booking.id)}
            disabled={checkingIn === booking.id}
            className="btn-primary"
          >
            {checkingIn === booking.id ? 'Checking in…' : '✅ Check In'}
          </button>
        )}
      </div>
    </div>
  );
}

// Invoices section — unpaid list (member self-service)
function InvoicesSection({ reloadKey }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/portal/invoices')
      .then((d) => setInvoices(d.invoices || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const open = invoices.filter((i) => ['unpaid', 'partial'].includes(i.status));

  return (
    <div className="card-premium p-5 mt-6" id="invoices">
      <h2 className="text-white font-bold mb-1">🧾 My Invoices</h2>
      <p className="text-slate-400 text-sm mb-4">
        {open.length === 0 ? 'All clear — no unpaid invoices. 🎉' : `${open.length} unpaid — pay at the front desk or via bank transfer.`}
      </p>
      {loading ? <Spinner /> : open.length === 0 ? null : (
        <div className="space-y-2">
          {open.slice(0, 5).map((inv) => {
            const due = Number(inv.amount) - Number(inv.amountPaid || 0);
            const overdue = inv.dueDate && new Date(inv.dueDate) < new Date();
            return (
              <div key={inv.id} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                <div>
                  <p className="text-white font-medium text-sm">{inv.number || inv.id.slice(0, 8)}</p>
                  <p className="text-slate-400 text-xs">Due {inv.dueDate ? fmtDate(inv.dueDate) : '—'} {overdue && <span className="text-red-300 font-bold">• overdue</span>}</p>
                </div>
                <p className={`font-bold ${overdue ? 'text-red-300' : 'text-amber-200'}`}>{fmtMoney(due)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const QUICK_ACTIONS = [
  { key: 'book', label: 'Book a Space', icon: '📅', action: 'modal-book' },
  { key: 'bookings', label: 'My Bookings', icon: '🗓️', action: 'anchor-bookings' },
  { key: 'invoices', label: 'Invoices', icon: '🧾', action: 'anchor-invoices' },
  { key: 'support', label: 'Support', icon: '🎫', action: 'link-/tickets' },
  { key: 'visitors', label: 'Visitors', icon: '🧑‍💼', action: 'modal-visitor' },
  { key: 'directory', label: 'Directory', icon: '🤝', action: 'link-/portal/directory' },
];

export default function PortalPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBook, setShowBook] = useState(false);
  const [showVisitor, setShowVisitor] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [checkingIn, setCheckingIn] = useState(null);
  const [loyalty, setLoyalty] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/portal/overview')
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
    api.get('/loyalty/balance').then(setLoyalty).catch(() => {});
  };

  useEffect(load, []);

  async function cancelBooking(id) {
    if (!confirm('Cancel this booking?')) return;
    setCancelling(id);
    try {
      await api.del(`/portal/bookings/${id}`);
      load();
    } catch (err) {
      alert(err.message || 'Cancel failed');
    } finally {
      setCancelling(null);
    }
  }

  async function checkIn(id) {
    setCheckingIn(id);
    try {
      await api.post(`/portal/bookings/${id}/check-in`);
      load();
    } catch (err) {
      alert(err.message || 'Check-in failed');
    } finally {
      setCheckingIn(null);
    }
  }

  function quickAction(a) {
    if (a === 'modal-book') setShowBook(true);
    else if (a === 'modal-visitor') setShowVisitor(true);
    else if (a.startsWith('anchor-')) {
      const el = document.getElementById(a.replace('anchor-', ''));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (a.startsWith('link-')) {
      window.location.href = a.replace('link-', '');
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <EmptyState title="No data" hint="Member record not found." />;

  const { member, contract, upcomingBookings, openTickets, unpaidTotal } = data;
  const nextBooking = upcomingBookings.find((b) => b.status !== 'cancelled') || null;
  const firstName = member.name?.split(' ')[0] || 'Member';
  const memberActive = (member.status || '').toLowerCase() === 'active';

  return (
    <div className="max-w-3xl mx-auto">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl p-6 mb-6 bg-gradient-to-br from-[#1c1c30] via-[#151524] to-[#0e0e1a] border border-violet-400/20 shadow-[0_0_40px_rgba(139,92,246,0.15)]">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -bottom-12 -left-8 w-40 h-40 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative">
          <p className="text-slate-300 text-sm">Assalam-o-Alaikum,</p>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white">{firstName} 👋</h1>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Badge tone={memberActive ? 'green' : 'slate'}>{memberActive ? '● Active member' : member.status || 'Member'}</Badge>
            {contract && (
              <span className="text-xs text-slate-300 bg-white/[0.05] border border-white/10 rounded-full px-3 py-1">
                📦 {contract.unit?.code} • {contract.unit?.type}
                {contract.endDate ? ` • till ${fmtDate(contract.endDate)}` : ' • ongoing'}
              </span>
            )}
          </div>
          {member.companyName && <p className="text-slate-400 text-sm mt-2">🏢 {member.companyName}</p>}
        </div>
      </div>

      <SurveyBanner />
      <MailBanner />

      {/* NEXT BOOKING + BALANCE */}
      <div className="grid md:grid-cols-2 gap-4 mb-6 mt-6">
        <NextBookingCard booking={nextBooking} onCheckIn={checkIn} checkingIn={checkingIn} />
        <div className="card-premium p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-semibold text-amber-200 uppercase tracking-wider mb-1">Balance due</p>
            <p className={`text-3xl font-extrabold ${unpaidTotal > 0 ? 'text-amber-200' : 'text-emerald-300'}`}>
              {fmtMoney(unpaidTotal)}
            </p>
            <p className="text-slate-400 text-xs mt-1">
              {unpaidTotal > 0 ? 'Pay at the front desk or via bank transfer.' : 'All invoices are settled. 🎉'}
            </p>
          </div>
          {unpaidTotal > 0 && (
            <button
              onClick={() => quickAction('anchor-invoices')}
              className="btn-primary text-sm mt-4 self-start"
            >
              Pay now →
            </button>
          )}
        </div>
      </div>

      {/* QUICK ACTIONS */}
      <h2 className="text-white font-bold mb-3">⚡ Quick Actions</h2>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => quickAction(a.action)}
            className="card-premium p-4 flex flex-col items-center gap-2 hover:border-blue-400/40 transition group"
          >
            <span className="text-2xl group-hover:scale-110 transition">{a.icon}</span>
            <span className="text-xs text-slate-200 font-medium text-center leading-tight">{a.label}</span>
          </button>
        ))}
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Upcoming Bookings" value={upcomingBookings.length} accent="blue" />
        <StatCard label="Open Tickets" value={openTickets.length} accent="amber" />
        <StatCard label="Unpaid Amount" value={fmtMoney(unpaidTotal)} accent={unpaidTotal > 0 ? 'red' : 'emerald'} />
        <StatCard label="Loyalty Points" value={loyalty ? Number(loyalty.balance || 0).toLocaleString() : '—'} accent="violet" />
      </div>

      {loyalty && Number(loyalty.balance || 0) > 0 && (
        <a href="/portal/loyalty" className="block card-premium p-4 mb-6 hover:border-violet-400/40 transition">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white">⭐ You have <span className="font-bold text-violet-300">{Number(loyalty.balance).toLocaleString()} loyalty points</span> ({fmtMoney(Number(loyalty.balance) * Number(loyalty.pointValue || 1))} value)</p>
            <span className="text-sm text-blue-300 underline shrink-0">View →</span>
          </div>
        </a>
      )}

      {/* MY BOOKINGS */}
      <div className="card-premium p-5" id="bookings">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold">My Upcoming Bookings</h2>
          <button onClick={() => setShowBook(true)} className="text-xs text-blue-300 hover:text-blue-200 underline">+ Book new</button>
        </div>
        {upcomingBookings.length === 0 ? (
          <p className="text-slate-400 text-sm">No upcoming bookings. <button onClick={() => setShowBook(true)} className="text-blue-300 underline">Book one now</button></p>
        ) : (
          <div className="space-y-3">
            {upcomingBookings.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                <div className="min-w-0">
                  <p className="text-white font-medium text-sm truncate">{b.title}</p>
                  <p className="text-slate-400 text-xs">{b.unit?.code} • {fmtDateTime(b.startAt)}</p>
                  {b.status === 'checked_in' && <p className="text-emerald-300 text-xs font-bold mt-0.5">✓ Checked in</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  {b.status !== 'checked_in' && (
                    <button
                      onClick={() => checkIn(b.id)}
                      disabled={checkingIn === b.id}
                      className="text-xs text-emerald-200 hover:text-emerald-100 border border-emerald-500/30 rounded-lg px-3 py-1.5"
                    >
                      {checkingIn === b.id ? '…' : 'Check in'}
                    </button>
                  )}
                  <button
                    onClick={() => cancelBooking(b.id)}
                    disabled={cancelling === b.id}
                    className="text-xs text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg px-3 py-1.5"
                  >
                    {cancelling === b.id ? '…' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <InvoicesSection reloadKey={loading} />

      {/* OPEN TICKETS */}
      <div className="card-premium p-5 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold">My Open Tickets</h2>
          <a href="/tickets" className="text-xs text-blue-300 hover:text-blue-200 underline">View all →</a>
        </div>
        {openTickets.length === 0 ? (
          <p className="text-slate-400 text-sm">No open tickets. 🎉</p>
        ) : (
          <div className="space-y-3">
            {openTickets.map((t) => (
              <div key={t.id} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                <div>
                  <p className="text-white font-medium text-sm">#{t.ticketNumber} — {t.title}</p>
                  <p className="text-slate-400 text-xs capitalize">{t.status.replace('_', ' ')} • {t.priority}</p>
                </div>
                <a href="/tickets" className="text-xs text-blue-300 hover:text-blue-200 underline">View</a>
              </div>
            ))}
          </div>
        )}
      </div>

      <CalendarFeedSection />

      {/* Announcements preview (latest 3) */}
      <AnnouncementsFeed />

      {/* Profile */}
      <div className="card-premium p-5 mt-6">
        <h2 className="text-white font-bold mb-4">My Profile</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><p className="text-slate-500 text-xs">Name</p><p className="text-white">{member.name}</p></div>
          <div><p className="text-slate-500 text-xs">Email</p><p className="text-white break-all">{member.email || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Phone</p><p className="text-white">{member.phone}</p></div>
          <div><p className="text-slate-500 text-xs">Company</p><p className="text-white">{member.companyName || '—'}</p></div>
        </div>
      </div>

      {/* Directory presence (opt-in) */}
      <DirectoryProfileSection />

      {showBook && <PortalBookingModal onClose={() => setShowBook(false)} onDone={() => { setShowBook(false); load(); }} />}
      {showVisitor && <VisitorInviteModal onClose={() => setShowVisitor(false)} onDone={() => { setShowVisitor(false); }} />}
      <AiAssistant />
    </div>
  );
}
