'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, StatCard, Field, Spinner, EmptyState, ErrorBanner, Badge } from '../../../components/ui';
import { useRequireRoles } from '../../../components/Protected';

const STAFF_ROLES = ['ceo', 'admin', 'manager', 'operations_manager', 'finance_officer', 'receptionist', 'super_admin'];

export default function PrintingPage() {
  useRequireRoles(...STAFF_ROLES);
  const [rows, setRows] = useState([]);
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ memberId: '', pages: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/printing');
      setRows(r.rows || []);
      setMonth(r.month || '');
    } catch (e) {
      setError(e.message || 'Failed to load printing credits');
    } finally {
      setLoading(false);
    }
  }

  async function searchMembers(q) {
    setSearch(q);
    if (q.length < 2) { setMembers([]); return; }
    try {
      const r = await api.get(`/members?search=${encodeURIComponent(q)}&limit=10`);
      setMembers(r.members || r || []);
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    const pages = parseInt(form.pages, 10);
    if (!form.memberId || !pages || pages <= 0) {
      setMsg({ ok: false, text: 'Select a member and enter pages.' });
      return;
    }
    setSaving(true);
    try {
      const r = await api.post('/printing/log', { memberId: form.memberId, pages, note: form.note || undefined });
      setMsg({
        ok: true,
        text: r.overage
          ? `Logged ${pages} pages — ${r.overage.pages} over quota, invoice ${r.overage.invoice.number} (Rs ${Number(r.overage.cost).toLocaleString()}) created.`
          : `Logged ${pages} pages. ${r.balance.remaining} pages remaining.`,
      });
      setForm({ memberId: '', pages: '', note: '' });
      setSearch('');
      setMembers([]);
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Logging failed' });
    } finally {
      setSaving(false);
    }
  }

  const totalUsed = rows.reduce((a, r) => a + r.used, 0);

  return (
    <div>
      <PageHeader title="Printing Credits" subtitle={`Quota overview — ${month}`} />
      {error && <ErrorBanner message={error} />}
      {msg && (
        <div className={`rounded-xl border p-4 text-sm mb-3 ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="card-premium p-5">
          <h2 className="text-lg font-bold text-gray-900 mb-3">🖨️ Quick log print job</h2>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Member">
              <input
                className="input"
                placeholder="Type name to search…"
                value={search}
                onChange={(e) => searchMembers(e.target.value)}
              />
              {members.length > 0 && (
                <div className="mt-1 rounded-xl border border-gray-200 bg-white max-h-40 overflow-auto">
                  {members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-slate-700/40"
                      onClick={() => { setForm((f) => ({ ...f, memberId: m.id })); setSearch(m.name); setMembers([]); }}
                    >
                      {m.name} <span className="text-slate-500">{m.companyName || ''}</span>
                    </button>
                  ))}
                </div>
              )}
              {form.memberId && <div className="text-xs text-emerald-700 mt-1">✓ Member selected</div>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pages">
                <input type="number" min="1" className="input" value={form.pages} onChange={(e) => setForm({ ...form, pages: e.target.value })} required />
              </Field>
              <Field label="Note (optional)">
                <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="A4 color…" />
              </Field>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Logging…' : 'Log print job'}</button>
          </form>
        </div>
        <StatCard label="Pages printed this month" value={totalUsed.toLocaleString()} />
      </div>
      <h2 className="text-lg font-bold text-gray-900 mb-3">Member quotas</h2>
      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="No quota rows yet" subtitle="Quotas are created automatically when members print or at month start." />
      ) : (
        <div className="overflow-x-auto card-premium overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="p-3">Member</th>
                <th className="p-3">Included</th>
                <th className="p-3">Used</th>
                <th className="p-3">Remaining</th>
                <th className="p-3">Usage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.included > 0 ? Math.min(100, Math.round((r.used / r.included) * 100)) : 0;
                return (
                  <tr key={r.memberId} className="border-b border-gray-200/50 hover:bg-gray-100/30">
                    <td className="p-3 text-gray-900">{r.memberName} <span className="text-slate-500 text-xs">{r.companyName || ''}</span></td>
                    <td className="p-3 text-gray-600">{r.included}</td>
                    <td className="p-3 text-gray-600">{r.used}</td>
                    <td className="p-3">{r.remaining <= 0 ? <Badge tone="red">0</Badge> : <span className="text-emerald-700">{r.remaining}</span>}</td>
                    <td className="p-3 w-40">
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
