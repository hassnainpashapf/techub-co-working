'use client';

// Phase 39 Track 1: Lead Management — table view (kanban board Track 9 mein).
// Filters (stage / source / assignedTo / search) + add/edit modal +
// activity timeline drawer + per-row stage change + convert to member.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import LeadFollowupTab from '../../../../components/LeadFollowupTab';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard, DataTable } from '../../../../components/ui';

const STAGES = [
  { key: 'new', label: 'New', tone: 'blue' },
  { key: 'contacted', label: 'Contacted', tone: 'amber' },
  { key: 'tour_scheduled', label: 'Tour Scheduled', tone: 'purple' },
  { key: 'quoted', label: 'Quoted', tone: 'purple' },
  { key: 'negotiating', label: 'Negotiating', tone: 'amber' },
  { key: 'won', label: 'Won', tone: 'green' },
  { key: 'lost', label: 'Lost', tone: 'slate' },
  // legacy Phase 29 kanban stages (read-only compat)
  { key: 'visit', label: 'Visit (legacy)', tone: 'slate' },
  { key: 'booked', label: 'Booked (legacy)', tone: 'green' },
];

const SOURCES = [
  { key: 'website', label: 'Website' },
  { key: 'walkin', label: 'Walk-in' },
  { key: 'referral', label: 'Referral' },
  { key: 'social', label: 'Social' },
  { key: 'other', label: 'Other' },
];

const ACTIVITY_TYPES = [
  { key: 'call', label: 'Call', tone: 'blue' },
  { key: 'email', label: 'Email', tone: 'purple' },
  { key: 'tour', label: 'Tour', tone: 'amber' },
  { key: 'note', label: 'Note', tone: 'slate' },
  { key: 'stage_change', label: 'Stage change', tone: 'green' },
];

const PIPELINE_STAGES = ['contacted', 'tour_scheduled', 'quoted', 'negotiating', 'visit'];

const stageMeta = (s) => STAGES.find((x) => x.key === s) || { label: s, tone: 'slate' };
const sourceLabel = (s) => (SOURCES.find((x) => x.key === s) || {}).label || s;
const activityMeta = (t) => ACTIVITY_TYPES.find((x) => x.key === t) || { label: t, tone: 'slate' };

function scoreTone(score) {
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  return 'slate';
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? '—' : n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Lead add/edit form
// ---------------------------------------------------------------------------
function LeadForm({ initial, users, onSave, saving }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    company: initial?.company || '',
    source: initial?.source || 'walkin',
    interest: initial?.interest || '',
    budget: initial?.budget ?? '',
    stage: initial?.stage || 'new',
    score: initial?.score ?? 0,
    assignedTo: initial?.assignedTo || '',
    notes: initial?.notes || '',
  });

  const save = (e) => {
    e.preventDefault();
    onSave({
      name: f.name.trim(),
      email: f.email.trim() || null,
      phone: f.phone.trim() || null,
      company: f.company.trim() || null,
      source: f.source,
      interest: f.interest.trim() || null,
      budget: f.budget === '' ? null : Number(f.budget),
      stage: f.stage,
      score: Math.min(100, Math.max(0, Number(f.score) || 0)),
      assignedTo: f.assignedTo || null,
      notes: f.notes.trim() || null,
    });
  };

  return (
    <form onSubmit={save}>
      <Field label="Name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="Prospect name" /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0300-1234567" /></Field>
        <Field label="Email"><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="prospect@example.com" /></Field>
        <Field label="Company"><input className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Company / org" /></Field>
        <Field label="Source">
          <select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
            {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Interested In (unit type)"><input className="input" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} placeholder="e.g. Private office" /></Field>
        <Field label="Budget"><input type="number" min="0" className="input" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} placeholder="Monthly budget" /></Field>
        <Field label="Stage">
          <select className="input" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Score (0–100)">
          <input type="number" min="0" max="100" className="input" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />
        </Field>
        <Field label="Assigned To">
          <select className="input" value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes"><textarea className="input" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes…" /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.name.trim()}>
        {saving ? 'Saving…' : (initial ? 'Update Lead' : 'Add Lead')}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Activity timeline drawer
// ---------------------------------------------------------------------------
function ActivityDrawer({ lead, users, onClose, onActivityAdded, onStageChanged }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('call');
  const [body, setBody] = useState('');
  const [tab, setTab] = useState('activity'); // activity | followups
  const [saving, setSaving] = useState(false);
  const [changingStage, setChangingStage] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.get(`/leads/${lead.id}/activities`);
      setActivities(d.activities || []);
    } catch (err) {
      setError(err.message || 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [lead.id]);

  const addActivity = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      await api.post(`/leads/${lead.id}/activity`, { type, body: body.trim() });
      setBody('');
      await load();
      onActivityAdded?.();
    } catch (err) {
      setError(err.message || 'Failed to add activity');
    } finally {
      setSaving(false);
    }
  };

  const changeStage = async (stage) => {
    setChangingStage(true);
    try {
      const d = await api.patch(`/leads/${lead.id}/stage`, { stage });
      await load();
      onStageChanged?.(d.lead);
    } catch (err) {
      setError(err.message || 'Failed to change stage');
    } finally {
      setChangingStage(false);
    }
  };

  const assignee = users.find((u) => u.id === lead.assignedTo);
  const meta = stageMeta(lead.stage);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-[#141422] border-l border-white/10 p-6 overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{lead.name}</h2>
            <p className="text-sm text-slate-400">{lead.company || 'No company'}</p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <Badge tone="slate">{sourceLabel(lead.source)}</Badge>
              {assignee && <span className="text-slate-400">· {assignee.name}</span>}
            </div>
            {(lead.phone || lead.email) && (
              <p className="mt-2 text-sm text-slate-300">
                {[lead.phone, lead.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div className="mb-6 rounded-lg border border-white/10 p-4">
          <p className="text-sm font-medium mb-2">Change stage</p>
          <select
            className="input w-full"
            value={lead.stage}
            disabled={changingStage}
            onChange={(e) => changeStage(e.target.value)}
          >
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <div className="mb-6 flex gap-2 border-b border-white/10">
          <button className={tab === 'activity' ? 'btn-ghost border-b-2 border-[#8b5cf6] !rounded-none' : 'btn-ghost !text-slate-500'} onClick={() => setTab('activity')}>🕘 Activity</button>
          <button className={tab === 'followups' ? 'btn-ghost border-b-2 border-[#8b5cf6] !rounded-none' : 'btn-ghost !text-slate-500'} onClick={() => setTab('followups')}>🔔 Follow-ups</button>
        </div>

        {tab === 'followups' ? (
          <LeadFollowupTab leadId={lead.id} />
        ) : (
        <>

        <div className="mb-6 rounded-lg border border-white/10 p-4">
          <p className="text-sm font-medium mb-2">Log activity</p>
          <form onSubmit={addActivity} className="space-y-3">
            <select className="input w-full" value={type} onChange={(e) => setType(e.target.value)}>
              {ACTIVITY_TYPES.filter((t) => t.key !== 'stage_change').map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <textarea className="input w-full" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened? (call notes, tour feedback…)" />
            <button type="submit" className="btn-primary w-full" disabled={saving || !body.trim()}>
              {saving ? 'Logging…' : 'Add to Timeline'}
            </button>
          </form>
        </div>

        <p className="text-sm font-medium mb-3">Timeline</p>
        {error && <ErrorBanner message={error} />}
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : activities.length === 0 ? (
          <EmptyState title="No activity yet" hint="Log the first call, email or tour above." />
        ) : (
          <div className="space-y-3">
            {activities.map((a) => {
              const am = activityMeta(a.type);
              return (
                <div key={a.id} className="rounded-lg border border-white/10 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone={am.tone}>{am.label}</Badge>
                    <span className="text-xs text-slate-500">{fmtDateTime(a.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{a.body}</p>
                  {a.creator?.name && <p className="mt-1 text-xs text-slate-500">by {a.creator.name}</p>}
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stage, setStage] = useState('');
  const [source, setSource] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [timelineLead, setTimelineLead] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (stage) q.set('stage', stage);
      if (source) q.set('source', source);
      if (assignedTo) q.set('assignedTo', assignedTo);
      if (search) q.set('search', search);
      const [d, ud] = await Promise.all([
        api.get(`/leads?${q.toString()}`),
        api.get('/users').catch(() => ({ users: [] })),
      ]);
      setLeads(d.leads || []);
      const salesRoles = ['ceo', 'admin', 'super_admin', 'manager', 'sales'];
      setUsers((ud.users || []).filter((u) => salesRoles.includes(u.role)));
    } catch (err) {
      setError(err.message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = (e) => { e.preventDefault(); load(); };
  const clearFilters = () => {
    setStage(''); setSource(''); setAssignedTo(''); setSearch('');
    setTimeout(load, 0);
  };

  const saveLead = async (data) => {
    setSaving(true);
    try {
      if (editing) {
        const d = await api.patch(`/leads/${editing.id}`, data);
        setLeads((ls) => ls.map((l) => (l.id === editing.id ? { ...l, ...d.lead } : l)));
        setEditing(null);
        if (timelineLead?.id === editing.id) setTimelineLead({ ...timelineLead, ...d.lead });
      } else {
        const d = await api.post('/leads', data);
        setLeads((ls) => [d.lead, ...ls]);
        setShowAdd(false);
      }
    } catch (err) {
      setError(err.message || 'Failed to save lead');
    } finally {
      setSaving(false);
    }
  };

  const quickStage = async (lead, newStage) => {
    if (lead.stage === newStage) return;
    setBusy(lead.id);
    try {
      const d = await api.patch(`/leads/${lead.id}/stage`, { stage: newStage });
      setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, ...d.lead } : l)));
    } catch (err) {
      setError(err.message || 'Failed to change stage');
    } finally {
      setBusy(null);
    }
  };

  const convert = async (lead) => {
    if (!confirm(`Convert ${lead.name} to a member?`)) return;
    setBusy(lead.id);
    try {
      const d = await api.post(`/leads/${lead.id}/convert`, {});
      setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, ...d.lead } : l)));
    } catch (err) {
      setError(err.message || 'Failed to convert lead');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (lead) => {
    if (!confirm(`Delete lead "${lead.name}"?`)) return;
    setBusy(lead.id);
    try {
      await api.delete(`/leads/${lead.id}`);
      setLeads((ls) => ls.filter((l) => l.id !== lead.id));
    } catch (err) {
      setError(err.message || 'Failed to delete lead');
    } finally {
      setBusy(null);
    }
  };

  const stats = {
    total: leads.length,
    fresh: leads.filter((l) => l.stage === 'new').length,
    pipeline: leads.filter((l) => PIPELINE_STAGES.includes(l.stage)).length,
    won: leads.filter((l) => l.stage === 'won').length,
  };

  const columns = ['Lead', 'Contact', 'Source', 'Interest', 'Budget', 'Score', 'Stage', 'Assigned', 'Last Contact', 'Added', 'Actions'];

  const rows = leads.map((l) => {
    const sm = stageMeta(l.stage);
    return [
      <div key="n">
        <div className="font-medium">{l.name}</div>
        {l.company && <div className="text-xs text-slate-500">{l.company}</div>}
      </div>,
      <div key="c" className="text-xs">
        {l.phone && <div>{l.phone}</div>}
        {l.email && <div className="text-slate-500">{l.email}</div>}
        {!l.phone && !l.email && '—'}
      </div>,
      <span key="s" className="text-sm">{sourceLabel(l.source)}</span>,
      <span key="i" className="text-sm">{l.interest || '—'}</span>,
      <span key="b" className="text-sm">{fmtMoney(l.budget)}</span>,
      <span key="sc"><Badge tone={scoreTone(l.score ?? 0)}>{l.score ?? 0}</Badge></span>,
      <select
        key="st"
        className="input !py-1 !px-2 text-xs max-w-[140px]"
        value={l.stage}
        disabled={busy === l.id}
        onChange={(e) => quickStage(l, e.target.value)}
        title="Change stage"
      >
        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>,
      <span key="a" className="text-sm">{l.assignee?.name || '—'}</span>,
      <span key="lc" className="text-sm">{fmtDate(l.lastContactAt)}</span>,
      <span key="ad" className="text-sm">{fmtDate(l.createdAt)}</span>,
      <div key="ac" className="flex gap-1">
        <button className="btn-ghost !px-2" title="Timeline" onClick={() => setTimelineLead(l)}>🕘</button>
        <button className="btn-ghost !px-2" title="Edit" onClick={() => setEditing(l)}>✏️</button>
        <button className="btn-ghost !px-2" title="Schedule tour" onClick={() => { window.location.href = `/sales/tours?leadId=${l.id}`; }}>📅</button>
        <button className="btn-ghost !px-2" title="Convert to member" disabled={busy === l.id || !!l.convertedMemberId} onClick={() => convert(l)}>→👤</button>
        <button className="btn-ghost !px-2" title="Delete" disabled={busy === l.id} onClick={() => remove(l)}>🗑️</button>
      </div>,
    ];
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        sub="Sales pipeline — capture prospects, move stages, log every touchpoint."
        actions={<button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add Lead</button>}
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Leads" value={stats.total} accent="blue" />
        <StatCard label="New" value={stats.fresh} accent="purple" />
        <StatCard label="In Pipeline" value={stats.pipeline} accent="amber" />
        <StatCard label="Won" value={stats.won} accent="green" />
      </div>

      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-[#16161f] p-4">
        <Field label="Search">
          <input className="input w-48" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, company, phone…" />
        </Field>
        <Field label="Stage">
          <select className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Source">
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Assigned To">
          <select className="input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <button type="submit" className="btn-primary">Apply</button>
        <button type="button" className="btn-ghost" onClick={clearFilters}>Clear</button>
      </form>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : leads.length === 0 ? (
        <EmptyState title="No leads found" hint="Add your first lead or adjust the filters." />
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}

      {showAdd && (
        <Modal title="Add Lead" onClose={() => setShowAdd(false)}>
          <LeadForm users={users} onSave={saveLead} saving={saving} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit Lead" onClose={() => setEditing(null)}>
          <LeadForm initial={editing} users={users} onSave={saveLead} saving={saving} />
        </Modal>
      )}
      {timelineLead && (
        <ActivityDrawer
          lead={timelineLead}
          users={users}
          onClose={() => setTimelineLead(null)}
          onActivityAdded={load}
          onStageChanged={(updated) => {
            setLeads((ls) => ls.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
            setTimelineLead((t) => ({ ...t, ...updated }));
          }}
        />
      )}
    </div>
  );
}
