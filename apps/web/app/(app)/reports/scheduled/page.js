'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const TYPES = [
  { value: 'occupancy', label: 'Occupancy' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'churn', label: 'Churn' },
  { value: 'pnl', label: 'Profit & Loss' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

function ReportForm({ initial, onSave, saving }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    reportType: initial?.reportType || 'occupancy',
    frequency: initial?.frequency || 'weekly',
    dayOfWeek: initial?.dayOfWeek ?? 1,
    dayOfMonth: initial?.dayOfMonth ?? 1,
    recipients: (initial?.recipients || []).join(', '),
    format: initial?.format || 'pdf',
    isActive: initial?.isActive ?? true,
  });
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({
        name: f.name,
        reportType: f.reportType,
        frequency: f.frequency,
        dayOfWeek: f.frequency === 'weekly' ? Number(f.dayOfWeek) : null,
        dayOfMonth: f.frequency === 'monthly' ? Number(f.dayOfMonth) : null,
        recipients: f.recipients.split(',').map((s) => s.trim()).filter(Boolean),
        format: f.format,
        isActive: f.isActive,
      });
    }}>
      <Field label="Report name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Report type *">
          <select className="input" value={f.reportType} onChange={(e) => setF({ ...f, reportType: e.target.value })}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Format *">
          <select className="input" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Frequency *">
          <select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        {f.frequency === 'weekly' ? (
          <Field label="Send on">
            <select className="input" value={f.dayOfWeek} onChange={(e) => setF({ ...f, dayOfWeek: e.target.value })}>
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Send on (day of month)">
            <select className="input" value={f.dayOfMonth} onChange={(e) => setF({ ...f, dayOfMonth: e.target.value })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label="Recipients * (comma separated emails)">
        <input className="input" value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} required placeholder="owner@company.com, finance@company.com" />
      </Field>
      <label className="flex items-center gap-3 mb-4 cursor-pointer">
        <button type="button" role="switch" aria-checked={f.isActive} onClick={() => setF({ ...f, isActive: !f.isActive })}
          className={`w-11 h-6 rounded-full relative transition-colors ${f.isActive ? 'bg-[#8b5cf6]' : 'bg-white/10'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${f.isActive ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <span className="text-sm text-white font-medium">Active</span>
      </label>
      <div className="flex justify-end gap-2">
        <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save report'}</button>
      </div>
    </form>
  );
}

export default function ScheduledReportsPage() {
  const gate = useRequireRoles('ceo', 'admin', 'super_admin');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/scheduled-reports')
      .then((d) => setReports(d.reports || []))
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function save(data) {
    setSaving(true);
    try {
      if (editing) await api.patch(`/scheduled-reports/${editing.id}`, data);
      else await api.post('/scheduled-reports', data);
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      alert(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this scheduled report?')) return;
    try {
      await api.del(`/scheduled-reports/${id}`);
      load();
    } catch (e) {
      alert(e.message || 'Delete failed');
    }
  }

  async function sendNow(id) {
    setSending(id);
    try {
      await api.post(`/scheduled-reports/${id}/send-now`);
      alert('Report queued — it will be emailed shortly.');
      load();
    } catch (e) {
      alert(e.message || 'Send failed');
    } finally {
      setSending(null);
    }
  }

  if (gate === 'loading') return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (gate === 'denied') return <AccessDenied />;
  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (error) return <ErrorBanner message={error} onRetry={load} />;

  return (
    <div>
      <PageHeader
        title="Scheduled Reports"
        sub="Automatic weekly/monthly report emails with PDF or CSV attachments"
        actions={<button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">+ New schedule</button>}
      />

      {reports.length === 0 ? (
        <EmptyState title="No scheduled reports" hint="Create one to get occupancy, revenue or P&L reports in your inbox automatically." />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {reports.map((r) => (
            <div key={r.id} className="card-premium p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-white font-semibold">{r.name}</p>
                  <p className="text-slate-400 text-xs mt-0.5">
                    {TYPE_LABEL[r.reportType] || r.reportType} • {r.frequency === 'weekly' ? 'Weekly' : 'Monthly'} • {String(r.format).toUpperCase()}
                  </p>
                </div>
                <Badge tone={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'Active' : 'Paused'}</Badge>
              </div>
              <p className="text-slate-400 text-xs mb-1">To: {(r.recipients || []).join(', ')}</p>
              <p className="text-slate-500 text-xs mb-4">
                Last sent: {r.lastSentAt ? new Date(r.lastSentAt).toLocaleString() : 'Never'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => sendNow(r.id)} disabled={sending === r.id} className="text-xs text-white bg-[#7c3aed]/80 hover:bg-[#7c3aed] rounded-lg px-3 py-1.5">
                  {sending === r.id ? 'Queuing…' : 'Send now'}
                </button>
                <button onClick={() => { setEditing(r); setShowForm(true); }} className="text-xs text-slate-300 hover:text-white border border-white/10 rounded-lg px-3 py-1.5">Edit</button>
                <button onClick={() => remove(r.id)} className="text-xs text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg px-3 py-1.5">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title={editing ? 'Edit scheduled report' : 'New scheduled report'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <ReportForm initial={editing} onSave={save} saving={saving} />
        </Modal>
      )}
    </div>
  );
}
