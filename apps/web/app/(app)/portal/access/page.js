'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Badge, Field, Spinner, EmptyState, ErrorBanner } from '../../../../components/ui';

function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const CRED_LABEL = { pin: '🔢 PIN Code', rfid: '💳 RFID Card', mobile: '📱 Mobile Key' };
const DIR_LABEL = { in: '➡️ Entry', out: '⬅️ Exit' };
const RESULT_TONE = { granted: 'green', denied: 'red' };
const PASS_TONE = { pending: 'amber', active: 'green', used: 'slate', expired: 'slate', revoked: 'red' };

function toISO(dtLocal) {
  if (!dtLocal) return undefined;
  const d = new Date(dtLocal);
  return isNaN(d) ? undefined : d.toISOString();
}

export default function MyAccessPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Request-pass form
  const [form, setForm] = useState({ visitorName: '', visitorPhone: '', validFrom: '', validUntil: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.get('/my-access');
      setData(d);
    } catch (e) {
      setError(e?.message || 'load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submitRequest = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormMsg(null);
    try {
      const payload = {
        visitorName: form.visitorName.trim(),
        visitorPhone: form.visitorPhone.trim() || undefined,
        validFrom: toISO(form.validFrom),
        validUntil: toISO(form.validUntil),
        notes: form.notes.trim() || undefined,
      };
      if (!payload.validUntil) throw new Error('Valid-until zaroori hai');
      const d = await api.post('/my-access/request-pass', payload);
      setFormMsg({ ok: true, text: d.message || 'Request bhej di gayi' });
      setForm({ visitorName: '', visitorPhone: '', validFrom: '', validUntil: '', notes: '' });
      load();
    } catch (e) {
      setFormMsg({ ok: false, text: e?.message || 'Request failed' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8"><Spinner /></div>;
  if (error) return <div className="p-8"><ErrorBanner message={error} onRetry={load} /></div>;

  const creds = data?.credentials || [];
  const schedules = data?.schedules || [];
  const entries = data?.entries || [];
  const passes = data?.myPassRequests || [];
  const pendingMig = data?.pendingMigration || [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="🔐 My Access"
        sub={data?.member ? `${data.member.name} · ${data.member.status}` : 'Entry access overview'}
      />

      {pendingMig.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          Access system ka kuch hissa abhi setup ho raha hai ({pendingMig.join(', ')}). Baqi sections neeche dikh rahe hain.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Credentials" value={creds.length} accent="blue" icon="🔑" />
        <StatCard label="Access Schedules" value={schedules.length} accent="violet" icon="🕒" />
        <StatCard label="Entries (30 din)" value={entries.length} accent="green" icon="🚪" />
        <StatCard label="Pass Requests" value={passes.length} accent="amber" icon="🎫" />
      </div>

      {/* Credentials + Schedules */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1c1c30] to-[#12121f] p-5">
          <h3 className="font-semibold mb-3">🔑 Meri Credentials</h3>
          {creds.length === 0 ? (
            <EmptyState title="Koi credential nahi" hint="Reception se PIN/RFID issue karwayein" />
          ) : (
            <div className="space-y-3">
              {creds.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl bg-black/30 p-3">
                  <div>
                    <div className="font-medium">{CRED_LABEL[c.type] || c.type} <span className="text-slate-400 tracking-widest">{c.masked}</span></div>
                    <div className="text-xs text-slate-400">
                      Last used: {fmtDateTime(c.lastUsedAt)}{c.expiresAt ? ` · Expires: ${fmtDateTime(c.expiresAt)}` : ''}
                    </div>
                  </div>
                  <Badge tone="green">active</Badge>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500 mt-3">PIN kabhi yahan nahi dikhta — bhool jayein to reception se naya issue karwayein.</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1c1c30] to-[#12121f] p-5">
          <h3 className="font-semibold mb-3">🕒 Meri Entry Timings</h3>
          {schedules.length === 0 ? (
            <EmptyState title="Koi schedule nahi" hint="Default timings apply hon gi" />
          ) : (
            <div className="space-y-3">
              {schedules.map((s) => (
                <div key={s.id} className="rounded-xl bg-black/30 p-3">
                  <div className="font-medium text-sm">{s.label}</div>
                  <div className="text-xs text-slate-400">{s.door} · {s.scope === 'personal' ? 'Mere liye' : 'Default'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Request visitor pass */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1c1c30] to-[#12121f] p-5">
        <h3 className="font-semibold mb-1">🎫 Visitor Day Pass Request</h3>
        <p className="text-sm text-slate-400 mb-4">Mehmaan ke liye pass mangwayein — reception approve karegi to QR pass milega.</p>
        <form onSubmit={submitRequest} className="grid md:grid-cols-2 gap-4">
          <Field label="Visitor ka naam *">
            <input className="input" value={form.visitorName} onChange={(e) => setForm({ ...form, visitorName: e.target.value })} required minLength={2} maxLength={120} />
          </Field>
          <Field label="Visitor ka phone">
            <input className="input" value={form.visitorPhone} onChange={(e) => setForm({ ...form, visitorPhone: e.target.value })} maxLength={30} />
          </Field>
          <Field label="Valid from">
            <input className="input" type="datetime-local" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
          </Field>
          <Field label="Valid until *">
            <input className="input" type="datetime-local" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} required />
          </Field>
          <div className="md:col-span-2">
            <Field label="Note (optional)">
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <button type="submit" disabled={submitting} className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 font-medium disabled:opacity-50">
              {submitting ? 'Bhej rahe hain…' : 'Request bhejein'}
            </button>
            {formMsg && (
              <p className={`mt-2 text-sm ${formMsg.ok ? 'text-green-300' : 'text-red-300'}`}>{formMsg.text}</p>
            )}
          </div>
        </form>

        {passes.length > 0 && (
          <div className="mt-5 space-y-2">
            <h4 className="text-sm font-medium text-slate-300">Meri requests</h4>
            {passes.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl bg-black/30 p-3 text-sm">
                <div>
                  <span className="font-medium">{p.visitorName}</span>
                  <span className="text-slate-400"> · {fmtDateTime(p.validFrom)} → {fmtDateTime(p.validUntil)}</span>
                </div>
                <Badge tone={PASS_TONE[p.status] || 'slate'}>{p.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Entry history */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1c1c30] to-[#12121f] p-5">
        <h3 className="font-semibold mb-3">🚪 Meri Entry History (30 din)</h3>
        {entries.length === 0 ? (
          <EmptyState title="Koi entry record nahi" hint="Pichhle 30 din me koi entry log nahi hui" />
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {entries.map((en) => (
              <div key={en.id} className="flex items-center justify-between rounded-xl bg-black/30 p-3 text-sm">
                <div>
                  <span className="font-medium">{en.door}</span>
                  <span className="text-slate-400"> · {DIR_LABEL[en.direction] || en.direction}{en.credentialType ? ` · ${en.credentialType}` : ''}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{fmtDateTime(en.at)}</span>
                  <Badge tone={RESULT_TONE[en.result] || 'slate'}>{en.result}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
