'use client';

// Phase 39 Track 5: per-lead "Follow-ups" tab component.
// Coordinator integration (apps/web/app/(app)/sales/leads/page.js):
//   import LeadFollowupTab from '../../../../../../components/LeadFollowupTab';
//   {selectedLead && <LeadFollowupTab leadId={selectedLead.id} />}
// (path ko leads page ki depth ke mutabiq adjust karein)

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Field, Spinner, ErrorBanner, EmptyState, Badge } from './ui';

const TYPES = [
  { key: 'call', label: '📞 Call', tone: 'blue' },
  { key: 'email', label: '✉️ Email', tone: 'violet' },
  { key: 'whatsapp', label: '💬 WhatsApp', tone: 'green' },
  { key: 'tour', label: '🏢 Tour', tone: 'amber' },
];
const toneFor = (t) => (TYPES.find((x) => x.key === t) || {}).tone || 'slate';
const labelFor = (t) => (TYPES.find((x) => x.key === t) || {}).label || t;

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function LeadFollowupTab({ leadId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ type: 'call', dueAt: '', note: '' });

  const load = async () => {
    if (!leadId) return;
    setLoading(true);
    setError('');
    try {
      const d = await api.get(`/lead-followups?leadId=${leadId}`);
      setRows(d.followups || []);
    } catch (e) {
      setError(e.message || 'Load failed');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [leadId]);

  const add = async (e) => {
    e.preventDefault();
    if (!form.dueAt) return;
    setSaving(true);
    try {
      const d = await api.post('/lead-followups', {
        leadId, type: form.type, dueAt: new Date(form.dueAt).toISOString(), note: form.note || null,
      });
      setRows((r) => [...r, d.followup]);
      setForm({ type: 'call', dueAt: '', note: '' });
    } catch (e2) { setError(e2.message || 'Add failed'); }
    setSaving(false);
  };

  const act = async (id, action) => {
    try {
      const d = await api.post(`/lead-followups/${id}/${action}`, {});
      setRows((r) => r.map((x) => (x.id === id ? d.followup : x)));
    } catch (e) { setError(e.message || 'Action failed'); }
  };

  const remove = async (id) => {
    if (!confirm('Ye follow-up delete karein?')) return;
    try {
      await api.del(`/lead-followups/${id}`);
      setRows((r) => r.filter((x) => x.id !== id));
    } catch (e) { setError(e.message || 'Delete failed'); }
  };

  if (loading) return <Spinner />;
  const pending = rows.filter((r) => r.status === 'pending');
  const past = rows.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} onClose={() => setError('')} />
      <form onSubmit={add} className="card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Naya Follow-up</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Type">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Due date & time *">
            <input type="datetime-local" className="input [color-scheme:dark]" value={form.dueAt}
              onChange={(e) => setForm({ ...form, dueAt: e.target.value })} required />
          </Field>
          <div className="flex items-end">
            <button className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Add'}</button>
          </div>
        </div>
        <Field label="Note"><textarea className="input" rows={2} value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Kya discuss karna hai…" /></Field>
      </form>

      <h3 className="font-semibold text-sm">Pending ({pending.length})</h3>
      {pending.length === 0 && <EmptyState title="Koi pending follow-up nahi" />}
      <div className="space-y-2">
        {pending.map((r) => (
          <div key={r.id} className="card p-3 flex items-center justify-between gap-3">
            <div className="text-sm">
              <Badge tone={toneFor(r.type)}>{labelFor(r.type)}</Badge>
              <span className="ml-2 font-medium">{fmtDate(r.dueAt)}</span>
              {r.note && <p className="text-gray-500 mt-1">{r.note}</p>}
              {r.assignee && <p className="text-xs text-slate-500 mt-1">Assigned: {r.assignee.name}</p>}
            </div>
            <div className="flex gap-2 shrink-0">
              <button className="btn-ghost text-xs" onClick={() => act(r.id, 'done')}>✓ Done</button>
              <button className="btn-ghost text-xs" onClick={() => act(r.id, 'skip')}>Skip</button>
              <button className="btn-ghost text-xs text-red-400" onClick={() => remove(r.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <h3 className="font-semibold text-sm text-gray-500">Completed / Skipped ({past.length})</h3>
          <div className="space-y-2">
            {past.map((r) => (
              <div key={r.id} className="card p-3 text-sm text-gray-500 flex justify-between">
                <span><Badge tone="slate">{r.status}</Badge> <span className="ml-2">{labelFor(r.type)} — {fmtDate(r.dueAt)}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
