'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Spinner, ErrorBanner, StatCard, DataTable } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const STATUS_COLORS = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  used: 'bg-slate-500/15 text-gray-600 border-slate-400/30',
  expired: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  revoked: 'bg-red-500/15 text-red-300 border-red-400/30',
};

function copy(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

export default function WifiPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'receptionist');
  const [vouchers, setVouchers] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showGen, setShowGen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState('');
  const [form, setForm] = useState({ count: 5, durationHours: 24, maxDevices: 2, memberId: '', expiresAt: '' });

  const load = async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (search) qs.set('search', search);
      const d = await api.get(`/wifi?${qs.toString()}`);
      setVouchers(d.vouchers || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (allowed) load(); }, [allowed, statusFilter]);
  useEffect(() => {
    if (!allowed) return;
    api.get('/members?limit=200').then((d) => setMembers(d.members || d || [])).catch(() => {});
  }, [allowed]);

  const generate = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        count: Number(form.count),
        durationHours: Number(form.durationHours),
        maxDevices: Number(form.maxDevices),
        memberId: form.memberId || null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      };
      const d = await api.post('/wifi/generate', payload);
      setShowGen(false);
      setForm({ count: 5, durationHours: 24, maxDevices: 2, memberId: '', expiresAt: '' });
      load();
      const codes = (d.vouchers || []).map((v) => v.code).join(', ');
      copy(codes);
      setCopied('codes');
      setTimeout(() => setCopied(''), 2500);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const revoke = async (id) => {
    if (!confirm('Revoke this voucher? It will stop working immediately.')) return;
    try { await api.post(`/wifi/${id}/revoke`); load(); }
    catch (e) { setError(e.message); }
  };

  if (roleLoading) return <div className="p-8"><Spinner /></div>;
  if (!allowed) return <AccessDenied />;

  const counts = { active: 0, used: 0, expired: 0, revoked: 0 };
  vouchers.forEach((v) => { if (counts[v.status] !== undefined) counts[v.status]++; });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="📶 WiFi Vouchers"
        subtitle="Guest WiFi access codes generate, assign aur manage karo"
        action={
          <button className="btn-primary" onClick={() => setShowGen(true)}>+ Generate Vouchers</button>
        }
      />
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active" value={counts.active} accent="green" />
        <StatCard label="Used" value={counts.used} accent="blue" />
        <StatCard label="Expired" value={counts.expired} accent="amber" />
        <StatCard label="Revoked" value={counts.revoked} accent="red" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {['', 'active', 'used', 'expired', 'revoked'].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              statusFilter === s
                ? 'bg-teal-600/20 border-teal-500/40 text-violet-200'
                : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-900'
            }`}
          >
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
        <input
          className="input ml-auto w-48"
          placeholder="Search code…"
          value={search}
          onChange={(e) => setSearch(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button className="btn-secondary" onClick={load}>Search</button>
      </div>

      {copied === 'codes' && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200 mb-4">
          ✅ New codes generated and copied to clipboard!
        </div>
      )}

      {loading ? <Spinner /> : (
        <DataTable
          columns={['Code', 'Member', 'Duration', 'Devices', 'Expires', 'Status', 'Actions']}
          empty="No vouchers yet — click Generate Vouchers."
          rows={vouchers.map((v) => [
            <span key="c" className="flex items-center gap-2">
              <code className="font-mono font-bold text-lg tracking-[0.2em] text-gray-900 bg-gray-100 px-3 py-1 rounded-lg border border-gray-200">{v.code}</code>
              <button
                className="text-xs text-teal-300 hover:text-violet-100"
                onClick={() => { copy(v.code); setCopied(v.id); setTimeout(() => setCopied(''), 1500); }}
              >{copied === v.id ? '✅ Copied' : '📋 Copy'}</button>
            </span>,
            v.member ? v.member.name : <span className="text-slate-500">—</span>,
            `${v.durationHours}h`,
            v.maxDevices,
            v.expiresAt ? new Date(v.expiresAt).toLocaleString() : <span className="text-slate-500">—</span>,
            <span key="s" className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[v.status] || STATUS_COLORS.active}`}>
              {v.status.toUpperCase()}
            </span>,
            v.status === 'active' ? (
              <button key="r" className="text-xs text-red-300 hover:text-red-100" onClick={() => revoke(v.id)}>Revoke</button>
            ) : <span key="r" className="text-gray-500 text-xs">—</span>,
          ])}
        />
      )}

      {showGen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4" onClick={() => setShowGen(false)}>
          <div className="card-premium w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Generate Vouchers</h2>
            <form onSubmit={generate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Count (1–100)</label>
                  <input type="number" min="1" max="100" className="input" value={form.count}
                    onChange={(e) => setForm({ ...form, count: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Duration (hours)</label>
                  <input type="number" min="1" max="720" className="input" value={form.durationHours}
                    onChange={(e) => setForm({ ...form, durationHours: e.target.value })} required />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Max devices</label>
                <input type="number" min="1" max="20" className="input" value={form.maxDevices}
                  onChange={(e) => setForm({ ...form, maxDevices: e.target.value })} required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Assign to member (optional)</label>
                <select className="input" value={form.memberId}
                  onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
                  <option value="">— Unassigned (guest codes) —</option>
                  {(Array.isArray(members) ? members : []).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}{m.email ? ` — ${m.email}` : ''}</option>
                  ))}
                </select>
                {form.memberId && (
                  <p className="text-xs text-gray-500 mt-1">📧 Code member ko email me bhej diya jayega.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Expires at (optional)</label>
                <input type="datetime-local" className="input" value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowGen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Generating…' : 'Generate'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
