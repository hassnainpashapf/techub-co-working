'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, Badge, Field } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const TYPE_TONES = {
  new_device: 'blue',
  suspicious: 'red',
  blocked_ip: 'amber',
};

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
  } catch { return ts; }
}

export default function SecurityPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [alerts, setAlerts] = useState([]);
  const [allowlist, setAllowlist] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [ipsText, setIpsText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [ackId, setAckId] = useState(null);

  const load = (silent = false) => {
    if (!silent) setError('');
    Promise.all([api.get('/login-security/alerts'), api.get('/login-security/ip-allowlist')])
      .then(([a, w]) => {
        setAlerts(a.alerts || []);
        setAllowlist(w.allowlist || []);
        setEnabled(!!w.enabled);
        setIpsText((w.allowlist || []).join('\n'));
      })
      .catch((e) => { if (!silent) setError(e.message); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const unacked = alerts.filter((a) => !a.acknowledgedAt).length;

  const acknowledge = async (id) => {
    setAckId(id);
    try { await api.post(`/login-security/alerts/${id}/acknowledge`); load(true); }
    catch (e) { setError(e.message); }
    finally { setAckId(null); }
  };

  const saveAllowlist = async () => {
    setSaving(true); setError('');
    try {
      const ips = ipsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const d = await api.put('/login-security/ip-allowlist', { ips });
      setAllowlist(d.allowlist || []);
      setEnabled(!!d.enabled);
      setIpsText((d.allowlist || []).join('\n'));
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Login Security" sub="New-device login alerts and IP allowlist" />

      {error && <ErrorBanner message={error} onRetry={() => load()} />}

      {/* ---- IP allowlist ---- */}
      <div className="rounded-2xl border border-gray-200/60 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">IP Allowlist</h2>
          <Badge tone={enabled ? 'green' : 'slate'}>{enabled ? `Enabled (${allowlist.length} IPs)` : 'Disabled'}</Badge>
        </div>
        <p className="text-sm text-gray-500 mb-3">
          When enabled, logins are allowed <b className="text-gray-800">only</b> from these IPs or CIDR ranges
          (e.g. <code className="text-gray-600">203.0.113.10</code> or <code className="text-gray-600">203.0.113.0/24</code>).
          Empty list = disabled (everyone can log in).
        </p>
        <Field label="Allowed IPs / CIDRs (one per line)">
          <textarea
            rows={5}
            value={ipsText}
            onChange={(e) => setIpsText(e.target.value)}
            placeholder={'203.0.113.10\n203.0.113.0/24'}
            className="w-full rounded-xl bg-white border border-gray-200/70 px-3 py-2 text-sm text-gray-900 font-mono focus:outline-none focus:border-[#0f766e]/60"
          />
        </Field>
        <button
          onClick={saveAllowlist}
          disabled={saving}
          className="mt-3 px-4 py-2 rounded-xl bg-gradient-to-r from-[#0f766e] to-indigo-600 text-gray-900 text-sm font-semibold hover:from-[#0f766e] hover:to-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Allowlist'}
        </button>
      </div>

      {/* ---- Alerts ---- */}
      <div className="rounded-2xl border border-gray-200/60 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Login Alerts</h2>
          <Badge tone={unacked ? 'amber' : 'green'}>{unacked} unacknowledged</Badge>
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-gray-500">No login alerts yet. New-device and blocked-IP logins will appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200/60">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">IP</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Device</th>
                  <th className="py-2 pr-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="border-b border-gray-200/60 hover:bg-gray-100/30">
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{fmtTime(a.createdAt)}</td>
                    <td className="py-2 pr-3 text-gray-900">{a.user?.name || a.user?.email || '—'}</td>
                    <td className="py-2 pr-3 font-mono text-gray-800">{a.ipAddress}</td>
                    <td className="py-2 pr-3"><Badge tone={TYPE_TONES[a.type] || 'slate'}>{a.type}</Badge></td>
                    <td className="py-2 pr-3 text-gray-500 max-w-[220px] truncate" title={a.userAgent || ''}>{a.userAgent || '—'}</td>
                    <td className="py-2 text-right">
                      {a.acknowledgedAt ? (
                        <span className="text-xs text-slate-500">Acknowledged</span>
                      ) : (
                        <button
                          onClick={() => acknowledge(a.id)}
                          disabled={ackId === a.id}
                          className="text-xs px-3 py-1 rounded-lg border border-gray-300 text-gray-800 hover:border-[#0f766e]/60 hover:text-gray-900 disabled:opacity-50"
                        >
                          {ackId === a.id ? '…' : 'Acknowledge'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
