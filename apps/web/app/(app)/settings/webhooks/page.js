'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function WebhookForm({ initial, events, onSave, saving }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    url: initial?.url || '',
    events: initial?.events || [],
    secret: initial?.secret || '',
    active: initial?.active ?? true,
  });
  const toggle = (e) => setF({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, secret: f.secret || null }); }}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="e.g. Accounting sync" /></Field>
      <Field label="URL"><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required placeholder="https://example.com/hook" /></Field>
      <Field label="Events">
        <div className="flex flex-wrap gap-2">
          {events.map((e) => (
            <label key={e} className={`px-3 py-1.5 rounded-lg text-xs font-mono border cursor-pointer ${f.events.includes(e) ? 'border-violet-400/60 bg-violet-500/20 text-violet-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
              <input type="checkbox" className="hidden" checked={f.events.includes(e)} onChange={() => toggle(e)} />
              {e}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Secret (optional — auto-generated if blank)">
        <input className="input font-mono text-xs" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} placeholder="HMAC signing secret" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-300 mb-4">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="accent-violet-500" />
        Active
      </label>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.events.length}>{saving ? 'Saving…' : 'Save Webhook'}</button>
    </form>
  );
}

function Deliveries({ webhookId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get(`/webhooks/${webhookId}/deliveries`)
      .then((d) => setRows(d.deliveries || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [webhookId]);
  if (loading) return <Spinner />;
  const cols = [
    { key: 'event', label: 'Event', render: (r) => <span className="font-mono text-xs text-slate-300">{r.event}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'success' ? 'green' : r.status === 'failed' ? 'red' : 'amber'}>{r.status}</Badge> },
    { key: 'code', label: 'HTTP', render: (r) => <span className="text-xs text-slate-400">{r.responseCode || '—'}</span> },
    { key: 'attempts', label: 'Attempts', render: (r) => <span className="text-xs text-slate-400">{r.attempts ?? 1}{r.status === 'failed' && (r.attempts ?? 1) > 1 ? ' (retrying)' : ''}</span> },
    { key: 'error', label: 'Error', render: (r) => <span className="text-xs text-red-300 truncate max-w-[200px] block">{r.error || '—'}</span> },
    { key: 'at', label: 'Time', render: (r) => <span className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</span> },
  ];
  return <DataTable columns={cols} rows={rows} emptyText="No deliveries yet." />;
}

export default function WebhooksPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [hooks, setHooks] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [viewDeliveries, setViewDeliveries] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/webhooks')
      .then((d) => { setHooks(d.webhooks || []); setEvents(d.availableEvents || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const save = async (data) => {
    setSaving(true);
    try {
      if (editing) await api.patch(`/webhooks/${editing.id}`, data);
      else await api.post('/webhooks', data);
      setShowForm(false); setEditing(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this webhook?')) return;
    try { await api.del(`/webhooks/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  const sendTest = async (id) => {
    try { await api.post(`/webhooks/${id}/test`); setError(''); alert('Test event sent — check deliveries.'); }
    catch (e) { setError(e.message); }
  };

  const cols = [
    { key: 'name', label: 'Name', render: (h) => <div><div className="font-medium text-white">{h.name}</div><div className="text-xs text-slate-400 font-mono truncate max-w-[260px]">{h.url}</div></div> },
    { key: 'events', label: 'Events', render: (h) => <div className="flex flex-wrap gap-1">{h.events.map((e) => <span key={e} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">{e}</span>)}</div> },
    { key: 'active', label: 'Status', render: (h) => <Badge tone={h.active ? 'green' : 'slate'}>{h.active ? 'active' : 'paused'}</Badge> },
    {
      key: 'action', label: '', render: (h) => (
        <div className="flex gap-2">
          <button className="text-xs text-blue-300 hover:text-blue-200" onClick={() => setViewDeliveries(h)}>Logs</button>
          <button className="text-xs text-slate-300 hover:text-white" onClick={() => sendTest(h.id)}>Test</button>
          <button className="text-xs text-slate-300 hover:text-white" onClick={() => { setEditing(h); setShowForm(true); }}>Edit</button>
          <button className="text-xs text-red-300 hover:text-red-200" onClick={() => remove(h.id)}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Webhooks"
        subtitle="Real-time event notifications to your systems"
        action={<button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ Add Webhook</button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError('')} />}
      {loading ? <Spinner /> : <DataTable columns={cols} rows={hooks} emptyText="No webhooks configured." />}
      {showForm && (
        <Modal title={editing ? 'Edit Webhook' : 'Add Webhook'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <WebhookForm initial={editing} events={events} onSave={save} saving={saving} />
        </Modal>
      )}
      {viewDeliveries && (
        <Modal title={`Deliveries — ${viewDeliveries.name}`} onClose={() => setViewDeliveries(null)}>
          <Deliveries webhookId={viewDeliveries.id} />
        </Modal>
      )}
    </div>
  );
}
