'use client';

// Phase 38 Track 2: Member Lifecycle Automation — settings page.
// Rules list + toggle + action select + template picker + runs history.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, Field, Badge } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-600/60'} ${disabled ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
      aria-pressed={on}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function TriggerCard({ trigger, templates, onChanged, saving, setSaving }) {
  const rule = trigger.rule;
  const [action, setAction] = useState(rule?.action || 'email');
  const [templateKey, setTemplateKey] = useState(rule?.templateKey || '');
  const [message, setMessage] = useState(rule?.message || '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const dirty = !rule || action !== rule.action || (templateKey || '') !== (rule.templateKey || '') || (message || '') !== (rule.message || '');

  const save = async (patch) => {
    setSaving(true);
    try {
      if (rule) {
        await api.patch(`/lifecycle/rules/${rule.id}`, patch);
      } else {
        await api.post('/lifecycle/rules', { trigger: trigger.key, ...patch });
      }
      onChanged();
    } catch (e) {
      alert(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!rule) return;
    if (!confirm(`Run "${trigger.label}" now? Matching members will be contacted.`)) return;
    setRunning(true);
    setResult(null);
    try {
      const d = await api.post(`/lifecycle/rules/${rule.id}/run`);
      setResult(`Evaluated ${d.evaluated}, sent ${d.sent}, skipped ${d.skipped}`);
      onChanged();
    } catch (e) {
      setResult(`Error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card-premium p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-gray-900 font-bold">{trigger.label}</h3>
          <p className="text-gray-500 text-sm mt-0.5">{trigger.description}</p>
        </div>
        <Toggle
          on={!!rule?.isActive}
          disabled={saving}
          onChange={(on) => save({ action, templateKey: templateKey || null, message: message || null, isActive: on })}
        />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Badge color={trigger.audience > 0 ? 'amber' : 'slate'}>
          {trigger.audience} member{trigger.audience === 1 ? '' : 's'} match now
        </Badge>
        {rule?.lastRunAt && (
          <span className="text-slate-500 text-xs">Last run {new Date(rule.lastRunAt).toLocaleString()}</span>
        )}
      </div>

      {rule?.isActive && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Channel">
            <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </Field>
          {action === 'email' ? (
            <Field label="Email template">
              <select className="input" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                <option value="">Default ({trigger.defaultTemplate})</option>
                {templates.map((t) => (
                  <option key={`${t.builtin ? 'b' : 'c'}:${t.key}`} value={t.key}>{t.label}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="SMS body (optional — {{variables}})">
              <input
                className="input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Leave empty for default message"
              />
            </Field>
          )}
        </div>
      )}

      {rule?.isActive && action === 'email' && (
        <div className="mt-3">
          <Field label="Custom note (optional — inserted into retention emails)">
            <input
              className="input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Reply with code WINBACK for 10% off"
            />
          </Field>
        </div>
      )}

      <div className="flex items-center gap-3 mt-4">
        {dirty && rule && (
          <button onClick={() => save({ action, templateKey: templateKey || null, message: message || null })} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
        {rule?.isActive && (
          <button onClick={runNow} disabled={running} className="btn-secondary text-sm">
            {running ? 'Running…' : '▶ Run now'}
          </button>
        )}
        {result && <span className="text-xs text-gray-500">{result}</span>}
      </div>

      <p className="text-gray-500 text-xs mt-3">Each member is contacted at most once per 30 days per rule.</p>
    </div>
  );
}

export default function LifecyclePage() {
  const { allowed } = useRequireRoles('ceo', 'admin');
  const [triggers, setTriggers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const [r, t, rn] = await Promise.all([
        api.get('/lifecycle/rules'),
        api.get('/lifecycle/templates'),
        api.get('/lifecycle/runs'),
      ]);
      setTriggers(r.triggers || []);
      setTemplates(t.templates || []);
      setRuns(rn.runs || []);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      await api.post('/lifecycle/rules/seed-defaults');
      await refresh();
    } catch (e) {
      setError(e.message || 'Seed failed');
    } finally {
      setSeeding(false);
    }
  };

  if (allowed === null || loading) return <div className="p-5 flex justify-center"><Spinner /></div>;
  if (allowed === false) return <AccessDenied />;

  const anyRule = triggers.some((t) => t.rule);

  return (
    <div>
      <PageHeader
        title="Lifecycle Automation"
        sub="Automatic email/SMS to members at key moments — trial ending, contract expiring, inactivity, overdue invoices."
        actions={
          !anyRule ? (
            <button onClick={seed} disabled={seeding} className="btn-primary text-sm">
              {seeding ? 'Enabling…' : '⚡ Enable all 4 defaults'}
            </button>
          ) : null
        }
      />
      <ErrorBanner message={error} onRetry={refresh} />

      <div className="mb-4 rounded-xl bg-[#0f766e]/10 border border-[#0f766e]/30 px-4 py-3 text-sm text-teal-700">
        💡 Customize email content in{' '}
        <Link href="/settings/email-templates" className="underline font-semibold">Email Templates</Link>
        {' '}— rules can use any built-in or custom template.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {triggers.map((t) => (
          <TriggerCard key={t.key} trigger={t} templates={templates} onChanged={refresh} saving={saving} setSaving={setSaving} />
        ))}
      </div>

      <h2 className="text-gray-900 font-bold mb-3">Recent sends</h2>
      {runs.length === 0 ? (
        <p className="text-slate-500 text-sm">No automated messages sent yet.</p>
      ) : (
        <div className="card-premium overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs border-b border-gray-200">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Trigger</th>
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Channel</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-gray-200 text-gray-600">
                  <td className="px-4 py-2.5 text-xs">{new Date(r.sentAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5">{r.triggerLabel}</td>
                  <td className="px-4 py-2.5">{r.memberName}</td>
                  <td className="px-4 py-2.5 capitalize">{r.channel}</td>
                  <td className="px-4 py-2.5">
                    {r.sent
                      ? <Badge color="emerald">Sent</Badge>
                      : <Badge color="red" title={r.error || ''}>Failed</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
