'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../components/ui';
import SurveyBanner from '../../../components/SurveyBanner';
import MailBanner from '../../../components/MailBanner';

function fmtMoney(n) {
  return `Rs ${Number(n || 0).toLocaleString()}`;
}

function fmtDateTime(s) {
  return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

// Announcements feed (phase 33) — pinned first, unread highlighted
function AnnouncementsFeed() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

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

  return (
    <div className="card-premium p-5 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-bold">📢 Announcements</h2>
        {unread > 0 && <span className="text-xs font-bold bg-blue-500/20 border border-blue-400/40 text-blue-200 rounded-full px-2.5 py-0.5">{unread} new</span>}
      </div>
      {loading ? <Spinner /> : items.length === 0 ? (
        <p className="text-slate-400 text-sm">No announcements right now.</p>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
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

export default function PortalPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBook, setShowBook] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/portal/overview')
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
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

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <EmptyState title="No data" hint="Member record not found." />;

  const { member, contract, upcomingBookings, openTickets, unpaidTotal } = data;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${member.name?.split(' ')[0] || 'Member'} 👋`}
        sub={contract ? `Active contract: ${contract.unit?.code} — ends ${contract.endDate ? new Date(contract.endDate).toLocaleDateString() : 'ongoing'}` : 'No active contract'}
        actions={
          <button onClick={() => setShowBook(true)} className="btn-primary">📅 Book a Space</button>
        }
      />

      <SurveyBanner />
      <MailBanner />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Upcoming Bookings" value={upcomingBookings.length} accent="blue" />
        <StatCard label="Open Tickets" value={openTickets.length} accent="amber" />
        <StatCard label="Unpaid Amount" value={fmtMoney(unpaidTotal)} accent={unpaidTotal > 0 ? 'red' : 'emerald'} />
        <StatCard label="Contract Status" value={contract ? 'Active' : 'None'} accent="violet" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upcoming bookings */}
        <div className="card-premium p-5">
          <h2 className="text-white font-bold mb-4">My Upcoming Bookings</h2>
          {upcomingBookings.length === 0 ? (
            <p className="text-slate-400 text-sm">No upcoming bookings. <button onClick={() => setShowBook(true)} className="text-blue-300 underline">Book one now</button></p>
          ) : (
            <div className="space-y-3">
              {upcomingBookings.map((b) => (
                <div key={b.id} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                  <div>
                    <p className="text-white font-medium text-sm">{b.title}</p>
                    <p className="text-slate-400 text-xs">{b.unit?.code} • {fmtDateTime(b.startAt)}</p>
                  </div>
                  <button
                    onClick={() => cancelBooking(b.id)}
                    disabled={cancelling === b.id}
                    className="text-xs text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg px-3 py-1.5"
                  >
                    {cancelling === b.id ? '…' : 'Cancel'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Open tickets */}
        <div className="card-premium p-5">
          <h2 className="text-white font-bold mb-4">My Open Tickets</h2>
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
      </div>

      {/* Announcements feed */}
      <AnnouncementsFeed />

      {/* Profile */}
      <div className="card-premium p-5 mt-6">
        <h2 className="text-white font-bold mb-4">My Profile</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><p className="text-slate-500 text-xs">Name</p><p className="text-white">{member.name}</p></div>
          <div><p className="text-slate-500 text-xs">Email</p><p className="text-white">{member.email || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Phone</p><p className="text-white">{member.phone}</p></div>
          <div><p className="text-slate-500 text-xs">Company</p><p className="text-white">{member.companyName || '—'}</p></div>
        </div>
      </div>

      {/* Directory presence (opt-in) */}
      <DirectoryProfileSection />

      {showBook && <PortalBookingModal onClose={() => setShowBook(false)} onDone={() => { setShowBook(false); load(); }} />}
    </div>
  );
}
