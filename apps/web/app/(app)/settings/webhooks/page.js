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
    // Secret is masked in list responses — prefill the mask so it isn't overwritten.
    secret: initial?.hasSecret ? '••••••••' : (initial?.secret || ''),
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
            <label key={e} className={`px-3 py-1.5 rounded-lg text-xs font-mono border cursor-pointer ${f.events.includes(e) ? 'border-teal-500/60 bg-teal-600/20 text-violet-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
              <input type="checkbox" className="hidden" checked={f.events.includes(e)} onChange={() => toggle(e)} />
              {e}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Secret (HMAC signing — shown once, then masked)">
        <input className="input font-mono text-xs" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} placeholder="Auto-generated if blank" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-gray-600 mb-3">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="accent-teal-600" />
        Active
      </label>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.events.length}>{saving ? 'Saving…' : 'Save Webhook'}</button>
    </form>
  );
}

function Deliveries({ webhookId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const loadRows = () => {
    setLoading(true);
    api.get(`/webhooks/${webhookId}/deliveries`)
      .then((d) => setRows(d.deliveries || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadRows(); }, [webhookId]);
  const resend = async (deliveryId) => {
    setBusy(deliveryId);
    try {
      await api.post(`/webhooks/${webhookId}/deliveries/${deliveryId}/resend`);
      loadRows();
    } catch (e) { alert(e.message); } finally { setBusy(null); }
  };
  if (loading) return <Spinner />;
  const cols = [
    { key: 'event', label: 'Event', render: (r) => <span className="font-mono text-xs text-gray-600">{r.event}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'success' ? 'green' : r.status === 'failed' ? 'red' : 'amber'}>{r.status}</Badge> },
    { key: 'code', label: 'HTTP', render: (r) => <span className="text-xs text-gray-500">{r.responseCode || '—'}</span> },
    { key: 'attempts', label: 'Attempts', render: (r) => <span className="text-xs text-gray-500">{r.attempts ?? 1}{r.status === 'failed' && (r.attempts ?? 1) > 1 ? ' (retrying)' : ''}</span> },
    { key: 'error', label: 'Error', render: (r) => <span className="text-xs text-red-700 truncate max-w-[200px] block">{r.error || '—'}</span> },
    { key: 'at', label: 'Time', render: (r) => <span className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString()}</span> },
    {
      key: 'resend', label: '', render: (r) => r.status === 'failed' ? (
        <button className="text-xs text-teal-700 hover:text-teal-700 disabled:opacity-50" disabled={busy === r.id} onClick={() => resend(r.id)}>
          {busy === r.id ? 'Sending…' : 'Resend'}
        </button>
      ) : null,
    },
  ];
  return <DataTable columns={cols} rows={rows} emptyText="No deliveries yet." />;
}

function TestConsole({ webhook, catalog, onClose }) {
  const [event, setEvent] = useState('webhook.test');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');
  const def = catalog.find((e) => e.name === event);
  const send = async () => {
    setSending(true); setResult('');
    try {
      await api.post(`/webhooks/${webhook.id}/test`, { event });
      setResult(`Sent "${event}" — check the Logs tab for delivery status.`);
    } catch (e) { setResult(`Error: ${e.message}`); } finally { setSending(false); }
  };
  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">
        Send a real signed test delivery to <span className="font-mono text-xs text-gray-800">{webhook.url}</span> using a catalog sample payload.
      </p>
      <Field label="Event">
        <select className="input" value={event} onChange={(e) => setEvent(e.target.value)}>
          {catalog.map((e) => <option key={e.name} value={e.name}>{e.name} — {e.description}</option>)}
        </select>
      </Field>
      <Field label="Payload preview (signed envelope wraps this in {event, tenantId, at, data})">
        <pre className="text-[11px] font-mono text-gray-600 bg-black/40 border border-gray-200 rounded-xl p-3 max-h-56 overflow-auto whitespace-pre-wrap">
          {JSON.stringify(def?.samplePayload || {}, null, 2)}
        </pre>
      </Field>
      {result && <p className="text-xs text-gray-600 mb-3">{result}</p>}
      <button className="btn-primary w-full" disabled={sending} onClick={send}>{sending ? 'Sending…' : 'Send test delivery'}</button>
    </div>
  );
}

export default function WebhooksPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [hooks, setHooks] = useState([]);
  const [events, setEvents] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [viewDeliveries, setViewDeliveries] = useState(null);
  const [testConsole, setTestConsole] = useState(null); // webhook object for test console
  const [secretModal, setSecretModal] = useState(null); // one-time secret display

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/webhooks'), api.get('/webhooks/events').catch(() => ({ events: [] }))])
      .then(([d, c]) => { setHooks(d.webhooks || []); setEvents(d.availableEvents || []); setCatalog(c.events || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;

  const save = async (data) => {
    setSaving(true);
    try {
      let d;
      if (editing) d = await api.patch(`/webhooks/${editing.id}`, data);
      else d = await api.post('/webhooks', data);
      setShowForm(false); setEditing(null); load();
      // New secret is shown ONCE — it is masked in all later responses.
      if (d?.webhook?.secret) setSecretModal({ title: 'Webhook secret', secret: d.webhook.secret });
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const regenSecret = async (h) => {
    if (!confirm(`Regenerate signing secret for "${h.name}"? Old signatures will stop working.`)) return;
    try {
      const d = await api.post(`/webhooks/${h.id}/secret`);
      setSecretModal({ title: `New secret — ${h.name}`, secret: d.secret });
      setError('');
    } catch (e) { setError(e.message); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this webhook?')) return;
    try { await api.del(`/webhooks/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  const sendTest = (h) => setTestConsole(h);

  const cols = [
    { key: 'name', label: 'Name', render: (h) => <div><div className="font-medium text-gray-900">{h.name}</div><div className="text-xs text-gray-500 font-mono truncate max-w-[260px]">{h.url}</div></div> },
    { key: 'events', label: 'Events', render: (h) => <div className="flex flex-wrap gap-1">{h.events.map((e) => <span key={e} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-600">{e}</span>)}</div> },
    { key: 'active', label: 'Status', render: (h) => <Badge tone={h.active ? 'green' : 'slate'}>{h.active ? 'active' : 'paused'}</Badge> },
    {
      key: 'action', label: '', render: (h) => (
        <div className="flex gap-2 flex-wrap">
          <button className="text-xs text-teal-700 hover:text-teal-700" onClick={() => setViewDeliveries(h)}>Logs</button>
          <button className="text-xs text-gray-600 hover:text-gray-900" onClick={() => sendTest(h)}>Test</button>
          <button className="text-xs text-amber-700 hover:text-amber-700" onClick={() => regenSecret(h)}>Secret</button>
          <button className="text-xs text-gray-600 hover:text-gray-900" onClick={() => { setEditing(h); setShowForm(true); }}>Edit</button>
          <button className="text-xs text-red-700 hover:text-red-700" onClick={() => remove(h.id)}>Delete</button>
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
      {testConsole && (
        <Modal title={`Test console — ${testConsole.name}`} onClose={() => setTestConsole(null)}>
          <TestConsole webhook={testConsole} catalog={catalog} onClose={() => setTestConsole(null)} />
        </Modal>
      )}
      {secretModal && (
        <Modal title={secretModal.title} onClose={() => setSecretModal(null)}>
          <p className="text-sm text-gray-600 mb-3">
            Copy this secret now — it will never be shown again. Receivers verify the{' '}
            <span className="font-mono text-xs text-teal-700">X-CoworkOS-Signature</span> header with it.
          </p>
          <div className="flex gap-2">
            <input className="input font-mono text-xs" readOnly value={secretModal.secret} onFocus={(e) => e.target.select()} />
            <button
              className="btn-secondary shrink-0"
              onClick={() => { navigator.clipboard?.writeText(secretModal.secret); }}
            >
              Copy
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
