'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';

const STATUSES = [
  { key: 'scheduled', label: 'Scheduled', tone: 'blue' },
  { key: 'completed', label: 'Completed', tone: 'green' },
  { key: 'cancelled', label: 'Cancelled', tone: 'slate' },
  { key: 'no_show', label: 'No Show', tone: 'red' },
];

const OUTCOMES = [
  { key: 'interested', label: 'Interested' },
  { key: 'not_interested', label: 'Not Interested' },
  { key: 'undecided', label: 'Undecided' },
];

const toneFor = (s) => (STATUSES.find((x) => x.key === s) || {}).tone || 'slate';
const labelFor = (s) => (STATUSES.find((x) => x.key === s) || {}).label || s;

function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isToday(s) {
  if (!s) return false;
  const d = new Date(s);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function ScheduleForm({ initial, leads, hosts, onSave, saving, preLeadId }) {
  const [f, setF] = useState({
    leadId: initial?.leadId || preLeadId || '',
    date: initial?.scheduledAt ? initial.scheduledAt.slice(0, 10) : '',
    time: initial?.scheduledAt ? new Date(initial.scheduledAt).toISOString().slice(11, 16) : '11:00',
    durationMin: initial?.durationMin || 30,
    assignedTo: initial?.assignedTo || '',
    notes: initial?.notes || '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, scheduledAt: `${f.date}T${f.time}:00` }); }}>
      <Field label="Lead *">
        <select className="input" value={f.leadId} onChange={(e) => setF({ ...f, leadId: e.target.value })} required disabled={!!initial}>
          <option value="">Select a lead…</option>
          {(leads || []).map((l) => (
            <option key={l.id} value={l.id}>{l.name}{l.company ? ` — ${l.company}` : ''}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date *"><input type="date" className="input [color-scheme:dark]" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
        <Field label="Time *"><input type="time" className="input [color-scheme:dark]" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} required /></Field>
        <Field label="Duration">
          <select className="input" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })}>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>1 hour</option>
          </select>
        </Field>
        <Field label="Host">
          <select className="input" value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}>
            <option value="">Auto (anyone)</option>
            {(hosts || []).map((h) => (
              <option key={h.id} value={h.id}>{h.name || h.email}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. interested in 2 desks near window…" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.leadId || !f.date || !f.time}>
        {saving ? 'Saving…' : (initial ? 'Reschedule Tour' : 'Schedule Tour')}
      </button>
    </form>
  );
}

export default function ToursPage() {
  const [tours, setTours] = useState([]);
  const [leads, setLeads] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('today'); // today | upcoming | past | all
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [outcome, setOutcome] = useState('interested');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [preLeadId, setPreLeadId] = useState('');

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('leadId');
      if (q) { setPreLeadId(q); setShowAdd(true); }
    } catch {}
  }, []);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [td, ld, ud] = await Promise.all([
        api.get('/tours'),
        api.get('/leads').catch(() => ({ leads: [] })),
        api.get('/users').catch(() => ({ users: [] })),
      ]);
      setTours(td.tours || []);
      setLeads(ld.leads || []);
      setHosts(ud.users || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const now = new Date();
    let list = tours;
    if (tab === 'today') list = list.filter((t) => t.status === 'scheduled' && isToday(t.scheduledAt));
    else if (tab === 'upcoming') list = list.filter((t) => t.status === 'scheduled' && new Date(t.scheduledAt) > now);
    else if (tab === 'past') list = list.filter((t) => t.status !== 'scheduled');
    if (status) list = list.filter((t) => t.status === status);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        (t.lead?.name || '').toLowerCase().includes(q) ||
        (t.lead?.company || '').toLowerCase().includes(q) ||
        (t.lead?.phone || '').includes(q)
      );
    }
    return [...list].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  }, [tours, tab, status, search]);

  const stats = useMemo(() => ({
    today: tours.filter((t) => t.status === 'scheduled' && isToday(t.scheduledAt)).length,
    upcoming: tours.filter((t) => t.status === 'scheduled' && new Date(t.scheduledAt) > new Date()).length,
    completed: tours.filter((t) => t.status === 'completed').length,
    noShow: tours.filter((t) => t.status === 'no_show').length,
  }), [tours]);

  const save = async (payload) => {
    setSaving(true); setError('');
    try {
      if (editing) {
        await api.patch(`/tours/${editing.id}`, {
          scheduledAt: payload.scheduledAt,
          durationMin: Number(payload.durationMin) || 30,
          assignedTo: payload.assignedTo || null,
          notes: payload.notes || null,
        });
      } else {
        await api.post('/tours', {
          leadId: payload.leadId,
          scheduledAt: payload.scheduledAt,
          durationMin: Number(payload.durationMin) || 30,
          assignedTo: payload.assignedTo || null,
          notes: payload.notes || null,
        });
      }
      setShowAdd(false); setEditing(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const action = async (id, what) => {
    if (what === 'cancel' && !confirm('Cancel this tour?')) return;
    setBusy(id); setError('');
    try {
      const body = what === 'complete' ? { outcome, notes: outcomeNotes || null } : undefined;
      const d = await api.post(`/tours/${id}/${what}`, body || {});
      setTours((ts) => ts.map((t) => (t.id === id ? d.tour : t)));
      if (what === 'complete') { setCompleting(null); setOutcome('interested'); setOutcomeNotes(''); }
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  const del = async (id) => {
    if (!confirm('Delete this tour record?')) return;
    setBusy(id); setError('');
    try {
      await api.delete(`/tours/${id}`);
      setTours((ts) => ts.filter((t) => t.id !== id));
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader
        title="Tour Scheduling"
        subtitle="Book and track site tours for your leads"
        actions={<button className="btn-primary" onClick={() => setShowAdd(true)}>+ Schedule Tour</button>}
      />
      {error && <ErrorBanner message={error} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard label="Today" value={stats.today} icon="📅" />
        <StatCard label="Upcoming" value={stats.upcoming} icon="⏰" />
        <StatCard label="Completed" value={stats.completed} icon="✅" />
        <StatCard label="No Shows" value={stats.noShow} icon="⚠️" />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {['today', 'upcoming', 'past', 'all'].map((t) => (
          <button key={t} className={`chip ${tab === t ? 'chip-active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input className="input !w-56" placeholder="Search lead…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState title="No tours here" body={tab === 'today' ? 'No tours scheduled for today.' : 'Try a different filter.'} />
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => (
            <div key={t.id} className="card p-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{t.lead?.name || 'Unknown lead'}</span>
                  <Badge tone={toneFor(t.status)}>{labelFor(t.status)}</Badge>
                  {isToday(t.scheduledAt) && t.status === 'scheduled' && <Badge tone="amber">Today</Badge>}
                  {t.outcome && <Badge tone="blue">{(OUTCOMES.find((o) => o.key === t.outcome) || {}).label || t.outcome}</Badge>}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  {fmtDateTime(t.scheduledAt)} · {t.durationMin} min
                  {t.lead?.phone && ` · ${t.lead.phone}`}
                  {t.assignee?.name && ` · Host: ${t.assignee.name}`}
                </div>
                {t.notes && <div className="text-sm text-gray-500 mt-1">{t.notes}</div>}
              </div>
              <div className="flex gap-2 flex-wrap">
                {t.status === 'scheduled' && (
                  <>
                    <button className="btn-secondary btn-sm" onClick={() => setCompleting(t)} disabled={busy === t.id}>Complete</button>
                    <button className="btn-secondary btn-sm" onClick={() => setEditing(t)} disabled={busy === t.id}>Reschedule</button>
                    <button className="btn-secondary btn-sm" onClick={() => action(t.id, 'no-show')} disabled={busy === t.id}>No Show</button>
                    <button className="btn-danger btn-sm" onClick={() => action(t.id, 'cancel')} disabled={busy === t.id}>Cancel</button>
                  </>
                )}
                {t.status !== 'scheduled' && (
                  <button className="btn-ghost btn-sm" onClick={() => del(t.id)} disabled={busy === t.id}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(showAdd || editing) && (
        <Modal title={editing ? 'Reschedule Tour' : 'Schedule Tour'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <ScheduleForm
            initial={editing}
            leads={leads}
            hosts={hosts}
            onSave={save}
            saving={saving}
            preLeadId={preLeadId}
          />
        </Modal>
      )}

      {completing && (
        <Modal title={`Complete Tour — ${completing.lead?.name}`} onClose={() => setCompleting(null)}>
          <div className="grid gap-3">
            <Field label="Outcome">
              <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Notes"><textarea className="input" rows={3} value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} placeholder="How did the tour go?…" /></Field>
            <button className="btn-primary w-full" onClick={() => action(completing.id, 'complete')} disabled={busy === completing.id}>
              {busy === completing.id ? 'Saving…' : 'Mark Completed'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
