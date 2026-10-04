'use client';

// Phase 38 Track 10: Smart Reminders Engine — rule builder + run console.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Field, Modal, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const TIMINGS = [
  { key: 'before', label: 'Before' },
  { key: 'after', label: 'After' },
];

function channelBadge(ch) {
  return <Badge key={ch} tone="blue">{ch}</Badge>;
}

function RuleModal({ rule, entities, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: rule?.name || '',
    entity: rule?.entity || 'invoice',
    timing: rule?.timing || 'before',
    daysOffset: rule?.daysOffset ?? 3,
    channels: rule?.channels || ['email'],
    templateKey: rule?.templateKey || '',
    isActive: rule ? !!rule.isActive : true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleChannel = (ch) => {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch) ? f.channels.filter((c) => c !== ch) : [...f.channels, ch],
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        daysOffset: Number(form.daysOffset) || 0,
        templateKey: form.templateKey.trim() || null,
      };
      if (rule) await api.patch(`/reminders/${rule.id}`, payload);
      else await api.post('/reminders', payload);
      onSaved();
    } catch (err) {
      setError(err.message || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title={rule ? 'Edit Reminder Rule' : 'New Reminder Rule'} onClose={onClose}>
      <form onSubmit={save}>
        {error && <ErrorBanner message={error} />}
        <Field label="Rule name">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Invoice due in 3 days" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entity">
            <select className="input" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })}>
              {entities.map((en) => <option key={en.key} value={en.key}>{en.label}</option>)}
            </select>
          </Field>
          <Field label="Timing">
            <select className="input" value={form.timing} onChange={(e) => setForm({ ...form, timing: e.target.value })}>
              {TIMINGS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Days offset">
          <input type="number" min={0} max={365} className="input" value={form.daysOffset} onChange={(e) => setForm({ ...form, daysOffset: e.target.value })} required />
          <p className="text-xs text-slate-500 mt-1">e.g. 3 days before the due date, or 7 days after.</p>
        </Field>
        <Field label="Channels">
          <div className="flex gap-2">
            {['email', 'sms', 'push'].map((ch) => (
              <label key={ch} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ${form.channels.includes(ch) ? 'border-[#0f766e]/50 bg-[#0f766e]/10 text-teal-700' : 'border-gray-200 text-gray-500'}`}>
                <input type="checkbox" checked={form.channels.includes(ch)} onChange={() => toggleChannel(ch)} className="accent-[#0f766e]" />
                {ch}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Template key (optional)">
          <input className="input" value={form.templateKey} onChange={(e) => setForm({ ...form, templateKey: e.target.value })} placeholder="Leave blank for the default template" />
        </Field>
        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <button type="button" role="switch" aria-checked={form.isActive} onClick={() => setForm({ ...form, isActive: !form.isActive })}
            className={`w-11 h-6 rounded-full relative transition-colors ${form.isActive ? 'bg-[#0f766e]' : 'bg-gray-100'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${form.isActive ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span className="text-sm text-gray-900 font-medium">Active</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || form.channels.length === 0} className="btn-primary">{saving ? 'Saving…' : 'Save rule'}</button>
        </div>
      </form>
    </Modal>
  );
}

function TestResultModal({ result, onClose }) {
  return (
    <Modal title="Dry-run preview" onClose={onClose}>
      <p className="text-sm text-gray-600 mb-3">
        This rule would remind <b className="text-gray-900">{result.count}</b> recipient{result.count === 1 ? '' : 's'} right now.
        {result.count > 0 && ' (Already-reminded items are excluded.)'}
      </p>
      {result.sample && result.sample.length > 0 && (
        <div className="space-y-2 mb-4">
          {result.sample.map((s) => (
            <div key={s.entityId} className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-600">{s.label}</div>
          ))}
          {result.count > result.sample.length && <p className="text-xs text-slate-500">…and {result.count - result.sample.length} more</p>}
        </div>
      )}
      <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Close</button></div>
    </Modal>
  );
}

export default function RemindersPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin', 'manager']);
  const [rules, setRules] = useState([]);
  const [entities, setEntities] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | rule
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async () => {
    try {
      const d = await api.get('/reminders');
      setRules(d.rules || []);
      setEntities(d.entities || []);
      const l = await api.get('/reminders/logs?limit=30');
      setLogs(l.logs || []);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  const toggleActive = async (rule) => {
    try {
      await api.patch(`/reminders/${rule.id}`, { isActive: !rule.isActive });
      load();
    } catch (err) { setError(err.message); }
  };

  const del = async (rule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await api.del(`/reminders/${rule.id}`);
      load();
    } catch (err) { setError(err.message); }
  };

  const test = async (rule) => {
    setTesting(rule.id);
    setError('');
    try {
      const d = await api.post(`/reminders/${rule.id}/test`);
      setTestResult(d);
    } catch (err) { setError(err.message); }
    finally { setTesting(null); }
  };

  const runNow = async () => {
    if (!confirm('Run the reminder engine for your tenant right now?')) return;
    setRunning(true);
    setNotice('');
    try {
      await api.post('/reminders/run');
      setNotice('Engine queued — it will run in the background. Refresh logs in a minute.');
    } catch (err) { setError(err.message); }
    finally { setRunning(false); }
  };

  return (
    <div>
      <PageHeader
        title="Smart Reminders"
        sub="One engine for invoice, contract, booking, maintenance and document reminders"
        actions={
          <div className="flex gap-2">
            <button onClick={runNow} disabled={running} className="btn-secondary">{running ? 'Queueing…' : '▶ Run now'}</button>
            <button onClick={() => setModal('new')} className="btn-primary">+ New rule</button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}
      {notice && <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">{notice}</div>}

      {rules.length === 0 ? (
        <EmptyState title="No reminder rules yet" hint="Create your first rule — e.g. remind members 3 days before an invoice is due." />
      ) : (
        <div className="grid gap-3 mb-8">
          {rules.map((r) => (
            <div key={r.id} className="card-premium p-4 flex flex-wrap items-center gap-3">
              <button type="button" role="switch" aria-checked={r.isActive} onClick={() => toggleActive(r)}
                className={`w-10 h-6 rounded-full relative transition-colors shrink-0 ${r.isActive ? 'bg-[#0f766e]' : 'bg-gray-100'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${r.isActive ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              <div className="flex-1 min-w-[180px]">
                <p className="text-gray-900 font-medium text-sm">{r.name}</p>
                <p className="text-slate-500 text-xs">
                  {(entities.find((e) => e.key === r.entity)?.label || r.entity)} — {r.daysOffset} day{r.daysOffset === 1 ? '' : 's'} {r.timing}
                </p>
              </div>
              <div className="flex gap-1.5">{(r.channels || []).map(channelBadge)}</div>
              <div className="text-xs text-slate-500 text-right">
                <p>{r.totalSent || 0} sent</p>
                <p>{r.lastSentAt ? `last ${new Date(r.lastSentAt).toLocaleDateString()}` : 'never sent'}</p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => test(r)} disabled={testing === r.id} className="text-xs text-teal-700 hover:text-teal-700 border border-[#0f766e]/30 rounded-lg px-3 py-1.5">
                  {testing === r.id ? '…' : 'Test'}
                </button>
                <button onClick={() => setModal(r)} className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5">Edit</button>
                <button onClick={() => del(r)} className="text-xs text-red-300 hover:text-red-200 border border-red-500/30 rounded-lg px-3 py-1.5">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-gray-900 font-bold mb-3">Recent sends</h2>
      {logs.length === 0 ? (
        <p className="text-slate-500 text-sm">No reminders sent yet.</p>
      ) : (
        <div className="card-premium overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-gray-200">
                <th className="px-4 py-2.5">Rule</th>
                <th className="px-4 py-2.5">Entity</th>
                <th className="px-4 py-2.5">Channels</th>
                <th className="px-4 py-2.5">Sent at</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2.5 text-gray-900">{l.rule?.name || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{l.rule?.entity || ''}</td>
                  <td className="px-4 py-2.5"><div className="flex gap-1.5">{(l.channelsSent || []).map(channelBadge)}</div></td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{new Date(l.sentAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <RuleModal
          rule={modal === 'new' ? null : modal}
          entities={entities}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
      {testResult && <TestResultModal result={testResult} onClose={() => setTestResult(null)} />}
    </div>
  );
}
