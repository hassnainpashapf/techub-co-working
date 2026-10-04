'use client';

// Phase 38 Track 6: Task Automation Rules — Zapier-style rule builder.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Modal, Field, Badge, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const TRIGGER_META = {
  invoice_overdue: {
    label: 'Invoice overdue',
    conditions: [
      { key: 'minDaysOverdue', label: 'Min days overdue', type: 'number', placeholder: '7' },
      { key: 'maxDaysOverdue', label: 'Max days overdue', type: 'number', placeholder: '30' },
      { key: 'minAmount', label: 'Min balance (Rs)', type: 'number', placeholder: '5000' },
    ],
    vars: '{{memberName}} {{invoiceNumber}} {{amount}} {{balance}} {{daysOverdue}}',
  },
  ticket_urgent_created: {
    label: 'Urgent ticket created',
    conditions: [],
    vars: '{{ticketNumber}} {{title}} {{memberName}} {{unitCode}}',
  },
  booking_cancelled: {
    label: 'Booking cancelled',
    conditions: [
      { key: 'unitType', label: 'Unit type (optional)', type: 'text', placeholder: 'meeting_room' },
      { key: 'minHoursBeforeStart', label: 'Min hours before start', type: 'number', placeholder: '24' },
    ],
    vars: '{{title}} {{unitCode}} {{memberName}} {{hoursBeforeStart}}',
  },
  contract_expiring: {
    label: 'Contract expiring',
    conditions: [
      { key: 'minDaysLeft', label: 'Min days left', type: 'number', placeholder: '7' },
      { key: 'maxDaysLeft', label: 'Max days left', type: 'number', placeholder: '30' },
    ],
    vars: '{{memberName}} {{unitCode}} {{daysLeft}}',
  },
  member_inactive: {
    label: 'Member inactive',
    conditions: [
      { key: 'minDaysInactive', label: 'Min days inactive', type: 'number', placeholder: '14' },
    ],
    vars: '{{memberName}} {{memberEmail}} {{daysInactive}}',
  },
};

const ACTION_TYPES = [
  { value: 'create_task', label: '📝 Create task' },
  { value: 'send_email', label: '✉️ Send email' },
  { value: 'notify_slack', label: '💬 Slack message' },
  { value: 'assign_ticket', label: '🎫 Assign ticket' },
];

function ActionEditor({ action, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...action, [k]: v });
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <select className="input flex-1" value={action.type} onChange={(e) => set('type', e.target.value)}>
          {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={onRemove} className="text-red-700 hover:text-red-700 text-sm">✕</button>
      </div>
      {action.type === 'create_task' && (
        <>
          <Field label="Task title ({{vars}} allowed)">
            <input className="input" value={action.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="Follow up with {{memberName}}" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select className="input" value={action.priority || 'medium'} onChange={(e) => set('priority', e.target.value)}>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Due in (days)">
              <input type="number" min="0" className="input" value={action.dueInDays ?? 3} onChange={(e) => set('dueInDays', Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Description">
            <textarea className="input" rows={2} value={action.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Details…" />
          </Field>
        </>
      )}
      {action.type === 'send_email' && (
        <>
          <Field label="To">
            <select className="input" value={action.to || 'member'} onChange={(e) => set('to', e.target.value)}>
              <option value="member">Member (from event)</option>
              <option value="staff">All staff (ceo/admin/manager)</option>
            </select>
          </Field>
          <Field label="Subject">
            <input className="input" value={action.subject || ''} onChange={(e) => set('subject', e.target.value)} placeholder="Reminder: {{invoiceNumber}}" />
          </Field>
          <Field label="Body (HTML)">
            <textarea className="input" rows={3} value={action.body || ''} onChange={(e) => set('body', e.target.value)} placeholder="Hi {{memberName}}, …" />
          </Field>
        </>
      )}
      {action.type === 'notify_slack' && (
        <Field label="Message">
          <textarea className="input" rows={2} value={action.text || ''} onChange={(e) => set('text', e.target.value)} placeholder="Overdue invoice {{invoiceNumber}} — Rs {{balance}}" />
        </Field>
      )}
      {action.type === 'assign_ticket' && (
        <Field label="Assignee user ID">
          <input className="input" value={action.assigneeId || ''} onChange={(e) => set('assigneeId', e.target.value)} placeholder="user id" />
        </Field>
      )}
    </div>
  );
}

function RuleModal({ rule, onClose, onSaved }) {
  const [name, setName] = useState(rule?.name || '');
  const [trigger, setTrigger] = useState(rule?.trigger || 'invoice_overdue');
  const [conditions, setConditions] = useState(rule?.conditions || {});
  const [actions, setActions] = useState(rule?.actions?.length ? rule.actions : [{ type: 'create_task' }]);
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const meta = TRIGGER_META[trigger];

  const save = async () => {
    setError(''); setBusy(true);
    try {
      const clean = {};
      for (const [k, v] of Object.entries(conditions)) {
        if (v !== '' && v != null) clean[k] = v;
      }
      const body = { name, trigger, conditions: clean, actions, isActive };
      if (rule) await api.patch(`/automation/${rule.id}`, body);
      else await api.post('/automation', body);
      onSaved();
    } catch (e) { setError(e.message || 'Save failed'); setBusy(false); }
  };

  return (
    <Modal title={rule ? 'Edit rule' : 'New automation rule'} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <Field label="Rule name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Escalate overdue invoices" />
      </Field>
      <Field label="When this happens (trigger)">
        <select className="input" value={trigger} onChange={(e) => { setTrigger(e.target.value); setConditions({}); }}>
          {Object.entries(TRIGGER_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
      </Field>
      {meta.conditions.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {meta.conditions.map((c) => (
            <Field key={c.key} label={c.label}>
              <input type={c.type} className="input" value={conditions[c.key] ?? ''} placeholder={c.placeholder}
                onChange={(e) => setConditions({ ...conditions, [c.key]: c.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} />
            </Field>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500 mb-2">Available variables: <code className="text-gray-500">{meta.vars}</code></p>
      <div className="space-y-3 mb-3">
        <p className="text-sm font-semibold text-gray-900">Then do (actions)</p>
        {actions.map((a, i) => (
          <ActionEditor key={i} action={a}
            onChange={(na) => setActions(actions.map((x, j) => (j === i ? na : x)))}
            onRemove={() => setActions(actions.filter((_, j) => j !== i))} />
        ))}
      </div>
      <button onClick={() => setActions([...actions, { type: 'send_email' }])} className="text-sm text-teal-700 hover:text-teal-700 mb-3">+ Add action</button>
      <label className="flex items-center gap-2 text-sm text-gray-600 mb-3">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-[#0f766e]" />
        Rule active
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={busy || !name || !actions.length} className="btn-primary">{busy ? 'Saving…' : 'Save rule'}</button>
      </div>
    </Modal>
  );
}

export default function AutomationPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [rules, setRules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const load = () => {
    setLoading(true); setError('');
    Promise.all([api.get('/automation'), api.get('/automation/runs')])
      .then(([r, rn]) => { setRules(r.rules || []); setRuns(rn.runs || []); })
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const del = async (id) => {
    if (!confirm('Delete this rule?')) return;
    await api.del(`/automation/${id}`).catch((e) => alert(e.message));
    load();
  };

  const test = async (rule) => {
    setTesting(rule.id); setTestResult(null);
    try {
      const r = await api.post(`/automation/${rule.id}/test`, {});
      setTestResult({ rule, ...r });
    } catch (e) { alert(e.message); }
    finally { setTesting(null); }
  };

  if (!allowed) return <AccessDenied />;
  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader title="Automation Rules" sub="Agar ye ho to wo karo — tasks, emails, Slack, ticket assignment"
        actions={<button onClick={() => setModal({})} className="btn-primary">+ New rule</button>} />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard label="Rules" value={rules.length} accent="blue" />
        <StatCard label="Active" value={rules.filter((r) => r.isActive).length} accent="emerald" />
        <StatCard label="Fired (recent)" value={runs.length} accent="violet" />
        <StatCard label="Triggers" value={Object.keys(TRIGGER_META).length} accent="amber" />
      </div>

      {rules.length === 0 ? (
        <EmptyState title="No automation rules yet" hint="Create your first rule — e.g. create a task when an invoice is 7+ days overdue." />
      ) : (
        <div className="space-y-3 mb-3">
          {rules.map((r) => (
            <div key={r.id} className="card-premium p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <p className="text-gray-900 font-semibold">{r.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  <Badge tone={r.isActive ? 'emerald' : 'slate'}>{TRIGGER_META[r.trigger]?.label || r.trigger}</Badge>
                  <span className="ml-2">{(r.actions || []).length} action{(r.actions || []).length !== 1 ? 's' : ''}</span>
                </p>
              </div>
              <button onClick={() => test(r)} disabled={testing === r.id} className="text-xs text-teal-700 border border-[#0f766e]/30 rounded-lg px-3 py-1.5 hover:bg-[#0f766e]/10">
                {testing === r.id ? '…' : '🧪 Test'}
              </button>
              <button onClick={() => setModal(r)} className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-100">Edit</button>
              <button onClick={() => del(r.id)} className="text-xs text-red-700 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50">Delete</button>
            </div>
          ))}
        </div>
      )}

      {testResult && (
        <div className="card-premium p-5 mb-3">
          <h2 className="text-gray-900 font-bold mb-3">🧪 Dry-run: {testResult.rule.name}</h2>
          <p className="text-sm text-gray-500 mb-3">
            Conditions matched: <Badge tone={testResult.conditionsMatched ? 'emerald' : 'red'}>{testResult.conditionsMatched ? 'Yes' : 'No'}</Badge>
          </p>
          {testResult.actions.map((a, i) => (
            <p key={i} className="text-sm text-gray-600 mb-1">• {a.summary} {!a.supported && <span className="text-red-700">(unsupported)</span>}</p>
          ))}
          <p className="text-xs text-slate-500 mt-3">{testResult.note}</p>
          <button onClick={() => setTestResult(null)} className="text-xs text-gray-500 underline mt-2">Close</button>
        </div>
      )}

      <div className="card-premium p-5">
        <h2 className="text-gray-900 font-bold mb-3">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-slate-500 text-sm">No runs yet.</p>
        ) : (
          <div className="space-y-2">
            {runs.map((rn) => (
              <div key={rn.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-gray-800">{rn.rule?.name || 'Rule'}</span>
                <span className="text-xs text-slate-500">{rn.trigger} • {new Date(rn.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal !== null && <RuleModal rule={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
    </div>
  );
}
