'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Spinner, EmptyState, ErrorBanner, Modal, Field } from '../../../../components/ui';

const PRIORITY_TONE = { low: 'slate', medium: 'blue', high: 'amber', urgent: 'red' };
const STATUS_TONE = { open: 'blue', in_progress: 'amber', resolved: 'green', closed: 'slate' };

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const EMPTY_FORM = { title: '', description: '', location: '', priority: 'medium' };

export default function PortalMaintenancePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/maintenance-requests/mine')
      .then((d) => setRows(d.requests || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const d = await api.post('/maintenance-requests', form);
      setRows((list) => [d.request, ...list]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      setMsg(form.priority === 'urgent' ? 'Reported as urgent — the ops team has been alerted.' : 'Request reported. We will look into it.');
    } catch (e2) {
      setMsg(e2.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Maintenance" sub="Report an issue in your space"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Report Issue</button>} />
      {error && <ErrorBanner message={error} onRetry={() => { setError(''); load(); }} />}
      {msg && <p className="text-sm text-emerald-300 mb-3">{msg}</p>}
      {rows.length === 0 ? (
        <EmptyState title="No requests yet" hint="Spot a leaking tap or a broken chair? Report it here and we'll fix it." />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {rows.map((r) => (
            <div key={r.id} className="card-premium p-5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-bold text-gray-900">{r.title}</h3>
                <Badge tone={PRIORITY_TONE[r.priority] || 'slate'}>{r.priority}</Badge>
              </div>
              {r.description && <p className="text-sm text-gray-600 whitespace-pre-wrap mb-3">{r.description}</p>}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{r.location || ''} {r.location ? '· ' : ''}{fmtDate(r.createdAt)}</span>
                <Badge tone={STATUS_TONE[r.status] || 'slate'}>{r.status.replace('_', ' ')}</Badge>
              </div>
              {r.assignedTo?.name && <p className="text-xs text-slate-500 mt-2">Assigned to {r.assignedTo.name}</p>}
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <Modal title="Report an Issue" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <Field label="What's wrong?">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} placeholder="e.g. AC not cooling in meeting room" />
            </Field>
            <Field label="Details">
              <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Anything that helps us fix it faster…" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Location">
                <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Floor 2 — washroom" />
              </Field>
              <Field label="Priority">
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
            </div>
            {form.priority === 'urgent' && <p className="text-xs text-red-300 mb-3">Urgent requests alert the ops team immediately.</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Submit Request'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
