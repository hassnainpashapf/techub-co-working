'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../context/AuthContext';
import { PageHeader, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

const PURPOSES = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'tour', label: 'Space Tour' },
  { value: 'interview', label: 'Interview' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'other', label: 'Other' },
];

function fmtDateTime(s) {
  return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusTone(status) {
  switch (status) {
    case 'pending': return 'blue';
    case 'checked_in': return 'green';
    case 'expired': return 'slate';
    case 'cancelled': return 'red';
    default: return 'slate';
  }
}

function statusLabel(status) {
  return { pending: 'Pending', checked_in: 'Checked In', expired: 'Expired', cancelled: 'Cancelled' }[status] || status;
}

// Invite form modal (member pre-registers a visitor)
function InviteModal({ onClose, onDone }) {
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitorEmail, setVisitorEmail] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('10:00');
  const [purpose, setPurpose] = useState('meeting');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api.post('/visitor-invites', {
        visitorName: visitorName.trim(),
        visitorPhone: visitorPhone.trim() || undefined,
        visitorEmail: visitorEmail.trim() || undefined,
        expectedAt: `${date}T${time}:00`,
        purpose,
        notes: notes.trim() || undefined,
      });
      onDone(data.invite);
    } catch (err) {
      setError(err.message || 'Invite failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="Invite a Visitor" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <Field label="Visitor name">
          <input className="input" value={visitorName} onChange={(e) => setVisitorName(e.target.value)} required maxLength={120} placeholder="e.g. Ahmed Khan" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Phone (optional)">
            <input className="input" value={visitorPhone} onChange={(e) => setVisitorPhone(e.target.value)} maxLength={30} placeholder="03xx xxxxxxx" />
          </Field>
          <Field label="Email (optional)">
            <input className="input" type="email" value={visitorEmail} onChange={(e) => setVisitorEmail(e.target.value)} placeholder="visitor@email.com" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Visit date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required min={new Date().toISOString().slice(0, 10)} />
          </Field>
          <Field label="Time">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </Field>
        </div>
        <Field label="Purpose">
          <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes (optional)">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} placeholder="Anything reception should know" />
        </Field>
        <button type="submit" disabled={busy} className="btn-primary w-full mt-2">
          {busy ? 'Creating invite…' : 'Create invite'}
        </button>
      </form>
    </Modal>
  );
}

// Success card shown right after creating an invite: code + share actions
function InviteSuccess({ invite, onClose }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const hostName = user?.name || user?.email || 'your host';
  const shareText = `Hi ${invite.visitorName}! You're expected at Techub on ${fmtDateTime(invite.expectedAt)}. Show this check-in code at reception: ${invite.code} (host: ${hostName})`;

  function copyCode() {
    navigator.clipboard.writeText(shareText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return (
    <Modal title="Invite created" onClose={onClose}>
      <div className="text-center">
        <p className="text-gray-600 text-sm mb-2">Check-in code for <span className="font-semibold text-gray-900">{invite.visitorName}</span></p>
        <div className="inline-block bg-gradient-to-br from-[#0f766e]/20 to-teal-700/20 border border-[#0f766e]/40 rounded-2xl px-8 py-5 mb-4">
          <div className="text-4xl font-bold tracking-[0.3em] text-teal-700">{invite.code}</div>
          <div className="text-xs text-gray-500 mt-1">{fmtDateTime(invite.expectedAt)}</div>
        </div>
        <p className="text-xs text-gray-500 mb-4">Visitor shows this code at reception for fast check-in.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={copyCode} className="btn-secondary flex-1">
            {copied ? 'Copied ✓' : 'Copy invite text'}
          </button>
          <a href={waUrl} target="_blank" rel="noreferrer" className="btn-primary flex-1 text-center">
            Share on WhatsApp
          </a>
        </div>
      </div>
    </Modal>
  );
}

export default function PortalVisitorsPage() {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newInvite, setNewInvite] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/visitor-invites/mine');
      setInvites(data.invites || []);
    } catch (err) {
      setError(err.message || 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function cancel(id) {
    if (!window.confirm('Cancel this visitor invite?')) return;
    setCancelling(id);
    try {
      await api.post(`/visitor-invites/${id}/cancel`, {});
      await load();
    } catch (err) {
      alert(err.message || 'Cancel failed');
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-10">
      <PageHeader
        title="Visitor Invites"
        sub="Pre-register visitors — they check in with a code at reception"
        actions={
          <button onClick={() => setShowForm(true)} className="btn-primary">+ Invite visitor</button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : invites.length === 0 ? (
        <EmptyState title="No visitor invites yet" hint="Invite someone and they'll get a check-in code for reception." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {invites.map((inv) => (
            <div key={inv.id} className="card p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="font-semibold text-gray-900">{inv.visitorName}</div>
                  <div className="text-xs text-gray-500">{fmtDateTime(inv.expectedAt)}</div>
                </div>
                <Badge tone={statusTone(inv.status)}>{statusLabel(inv.status)}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  Code <span className="font-mono font-bold text-teal-700 tracking-widest">{inv.code}</span>
                </div>
                <div className="text-xs text-gray-500 capitalize">{inv.purpose}</div>
              </div>
              {inv.status === 'pending' && (
                <button
                  onClick={() => cancel(inv.id)}
                  disabled={cancelling === inv.id}
                  className="btn-danger w-full mt-3 text-sm"
                >
                  {cancelling === inv.id ? 'Cancelling…' : 'Cancel invite'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <InviteModal
          onClose={() => setShowForm(false)}
          onDone={(invite) => { setShowForm(false); setNewInvite(invite); load(); }}
        />
      )}
      {newInvite && <InviteSuccess invite={newInvite} onClose={() => setNewInvite(null)} />}
    </div>
  );
}
