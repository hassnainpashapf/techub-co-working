'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const STATUS_TONE = { draft: 'slate', scheduled: 'blue', sending: 'amber', sent: 'green' };
const SEGMENTS = [
  { value: 'all', label: 'All members' },
  { value: 'active', label: 'Active members' },
  { value: 'trial', label: 'Trial members' },
  { value: 'on_hold', label: 'On-hold members' },
  { value: 'custom', label: 'Custom emails' },
];

function CampaignForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    subject: initial?.subject || '',
    bodyHtml: initial?.bodyHtml || '',
    segmentType: initial?.segment?.type || 'all',
    customEmails: (initial?.segment?.emails || []).join(', '),
  });
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({
        name: f.name,
        subject: f.subject,
        bodyHtml: f.bodyHtml,
        segment: {
          type: f.segmentType,
          emails: f.segmentType === 'custom' ? f.customEmails.split(',').map((s) => s.trim()).filter(Boolean) : [],
        },
      });
    }}>
      <Field label="Campaign name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} /></Field>
      <Field label="Subject *"><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required maxLength={300} /></Field>
      <Field label="Audience">
        <select className="input" value={f.segmentType} onChange={(e) => setF({ ...f, segmentType: e.target.value })}>
          {SEGMENTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      {f.segmentType === 'custom' && (
        <Field label="Emails (comma separated)"><textarea className="input" rows={2} value={f.customEmails} onChange={(e) => setF({ ...f, customEmails: e.target.value })} placeholder="a@x.com, b@y.com" /></Field>
      )}
      <Field label="Body (HTML) * — use {{name}} for personalization">
        <textarea className="input font-mono text-sm" rows={8} value={f.bodyHtml} onChange={(e) => setF({ ...f, bodyHtml: e.target.value })} required placeholder="<p>Hi {{name}}, …</p>" />
      </Field>
      <button className="btn-primary w-full" disabled={saving}>{saving ? 'Saving…' : 'Save campaign'}</button>
    </form>
  );
}

export default function CampaignsPage() {
  const gate = useRequireRoles('ceo', 'admin', 'super_admin', 'manager');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsId, setStatsId] = useState(null);
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const d = await api.get('/campaigns');
      setRows(d.campaigns || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (gate === 'ok') load(); }, [gate]);

  if (gate === 'loading') return <div className="p-5"><Spinner /></div>;
  if (gate === 'denied') return <AccessDenied />;

  const save = async (data) => {
    setSaving(true);
    try {
      if (editing) await api.patch(`/campaigns/${editing.id}`, data);
      else await api.post('/campaigns', data);
      setShowForm(false); setEditing(null); load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const sendNow = async (c) => {
    if (!confirm(`Send "${c.name}" to the selected audience now?`)) return;
    try {
      const d = await api.post(`/campaigns/${c.id}/send`, {});
      setNotice(`Queued — ${d.queued} emails will be sent.`);
      load();
    } catch (e) { setError(e.message); }
  };

  const schedule = async (c) => {
    const at = prompt('Schedule send (YYYY-MM-DD HH:MM, 24h):', '');
    if (!at) return;
    const dt = new Date(at.replace(' ', 'T') + ':00');
    if (isNaN(dt)) { setError('Invalid date'); return; }
    try {
      await api.post(`/campaigns/${c.id}/send`, { scheduledAt: dt.toISOString() });
      setNotice('Scheduled.');
      load();
    } catch (e) { setError(e.message); }
  };

  const testSend = async (c) => {
    try {
      const d = await api.post(`/campaigns/${c.id}/test`, {});
      setNotice(`Test email sent to ${d.to}.`);
    } catch (e) { setError(e.message); }
  };

  const viewStats = async (c) => {
    try {
      const d = await api.get(`/campaigns/${c.id}`);
      setStats(d.stats); setStatsId(c.id);
    } catch (e) { setError(e.message); }
  };

  const remove = async (c) => {
    if (!confirm(`Delete campaign "${c.name}"?`)) return;
    try { await api.delete(`/campaigns/${c.id}`); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Email Campaigns" sub="Build, schedule and send bulk emails to members" actions={
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New campaign</button>
      } />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {notice && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="No campaigns yet" hint="Create your first campaign to email members in bulk." />
      ) : (
        <div className="grid gap-3">
          {rows.map((c) => (
            <div key={c.id} className="card-premium p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-gray-900">{c.name}</h3>
                    <Badge tone={STATUS_TONE[c.status] || 'slate'}>{c.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{c.subject}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Audience: {c.segment?.type || 'all'} · Recipients: {c.recipientCount} · Sent: {c.sentCount}
                    {c.scheduledAt ? ` · Scheduled: ${new Date(c.scheduledAt).toLocaleString()}` : ''}
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button className="btn-ghost btn-sm" onClick={() => viewStats(c)}>Stats</button>
                  <button className="btn-ghost btn-sm" onClick={() => testSend(c)}>Test</button>
                  {c.status === 'draft' && <>
                    <button className="btn-ghost btn-sm" onClick={() => { setEditing(c); setShowForm(true); }}>Edit</button>
                    <button className="btn-ghost btn-sm" onClick={() => schedule(c)}>Schedule</button>
                    <button className="btn-primary btn-sm" onClick={() => sendNow(c)}>Send now</button>
                    <button className="btn-ghost btn-sm text-red-700" onClick={() => remove(c)}>Delete</button>
                  </>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <Modal title={editing ? 'Edit campaign' : 'New campaign'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <CampaignForm initial={editing} onSave={save} saving={saving} />
        </Modal>
      )}
      {stats && (
        <Modal title="Campaign stats" onClose={() => { setStats(null); setStatsId(null); }}>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Recipients" value={stats.recipients} />
            <StatCard label="Sent" value={stats.sent} accent="green" />
            <StatCard label="Unsubscribed" value={stats.unsubscribed} accent="red" />
          </div>
        </Modal>
      )}
    </div>
  );
}
