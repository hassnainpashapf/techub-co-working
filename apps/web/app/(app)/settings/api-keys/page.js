'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, DataTable } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

function KeyForm({ scopes, onSave, saving }) {
  const [f, setF] = useState({ name: '', scopes: ['bookings:read', 'members:read'], expiresInDays: 365, rateLimitPerMin: '' });
  const toggle = (s) => setF({ ...f, scopes: f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s] });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, expiresInDays: f.expiresInDays || null, rateLimitPerMin: f.rateLimitPerMin ? Number(f.rateLimitPerMin) : null }); }}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="e.g. Accounting sync" /></Field>
      <Field label="Scopes">
        <div className="flex flex-wrap gap-2">
          {scopes.map((s) => (
            <label key={s} className={`px-3 py-1.5 rounded-lg text-xs font-mono border cursor-pointer ${f.scopes.includes(s) ? 'border-violet-400/60 bg-violet-500/20 text-violet-200' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
              <input type="checkbox" className="hidden" checked={f.scopes.includes(s)} onChange={() => toggle(s)} />
              {s}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Expires in (days — blank for never)">
        <input type="number" min="1" max="3650" className="input" value={f.expiresInDays || ''} onChange={(e) => setF({ ...f, expiresInDays: e.target.value ? Number(e.target.value) : null })} placeholder="Never" />
      </Field>
      <Field label="Rate limit (requests/min — blank for unlimited)">
        <input type="number" min="1" max="100000" className="input" value={f.rateLimitPerMin} onChange={(e) => setF({ ...f, rateLimitPerMin: e.target.value })} placeholder="Unlimited" />
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={saving || !f.scopes.length}>{saving ? 'Creating…' : 'Generate API Key'}</button>
    </form>
  );
}

export default function ApiKeysPage() {
  const { allowed } = useRequireRoles(['ceo', 'admin', 'super_admin']);
  const [keys, setKeys] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState(null); // full key shown once
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api-keys')
      .then((d) => { setKeys(d.apiKeys || []); setScopes(d.availableScopes || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (data) => {
    setSaving(true);
    try {
      const d = await api.post('/api-keys', data);
      setNewKey(d.key);
      setShowForm(false);
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const revoke = async (id) => {
    if (!confirm('Revoke this API key? External systems using it will stop working.')) return;
    try { await api.delete(`/api-keys/${id}`); load(); }
    catch (e) { setError(e.message); }
  };

  const setLimit = async (r) => {
    const v = prompt(`Rate limit for "${r.name}" (requests per minute, blank = unlimited):`, r.rateLimitPerMin || '');
    if (v === null) return;
    const n = v.trim() === '' ? null : Number(v);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100000)) { alert('Enter 1–100000 or leave blank.'); return; }
    try { await api.patch(`/api-keys/${r.id}`, { rateLimitPerMin: n }); load(); }
    catch (e) { setError(e.message); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* ignore */ }
  };

  if (!allowed) return <AccessDenied />;
  if (loading) return <Spinner />;

  const cols = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-white">{r.name}</span> },
    { key: 'prefix', label: 'Key', render: (r) => <span className="font-mono text-xs text-slate-300">cwk_{r.keyPrefix}…</span> },
    { key: 'scopes', label: 'Scopes', render: (r) => <span className="font-mono text-[11px] text-slate-400">{(r.scopes || []).join(', ')}</span> },
    { key: 'lastUsed', label: 'Last used', render: (r) => <span className="text-xs text-slate-400">{r.lastUsedAt ? new Date(r.lastUsedAt).toLocaleString() : 'Never'}</span> },
    { key: 'expires', label: 'Expires', render: (r) => <span className="text-xs text-slate-400">{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : 'Never'}</span> },
    { key: 'rateLimit', label: 'Rate limit', render: (r) => <span className="text-xs text-slate-400">{r.rateLimitPerMin ? `${r.rateLimitPerMin}/min` : 'Unlimited'}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'green' : r.status === 'expired' ? 'amber' : 'red'}>{r.status}</Badge> },
    { key: 'actions', label: '', render: (r) => r.status === 'active' ? (
      <span className="flex gap-3">
        <button onClick={() => setLimit(r)} className="text-xs text-indigo-300 hover:text-indigo-200 underline">Set limit</button>
        <button onClick={() => revoke(r.id)} className="text-xs text-red-300 hover:text-red-200 underline">Revoke</button>
      </span>
    ) : null },
  ];

  return (
    <div>
      <PageHeader
        title="API Keys"
        subtitle="Keys for external systems to call the CoworkOS API"
        action={<button onClick={() => setShowForm(true)} className="btn-primary">+ New API Key</button>}
      />
      {error && <ErrorBanner message={error} />}
      <DataTable columns={cols} rows={keys} emptyText="No API keys yet. Generate one to let external systems integrate." />

      {showForm && (
        <Modal title="Generate API Key" onClose={() => setShowForm(false)}>
          <KeyForm scopes={scopes} onSave={create} saving={saving} />
        </Modal>
      )}

      {newKey && (
        <Modal title="API Key Created" onClose={() => setNewKey(null)}>
          <p className="text-sm text-amber-200 mb-3">⚠️ Copy this key now — it will never be shown again.</p>
          <div className="flex items-center gap-2 mb-4">
            <code className="flex-1 font-mono text-xs bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-emerald-300 break-all">{newKey}</code>
            <button onClick={copy} className="btn-secondary text-xs whitespace-nowrap">{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
          <p className="text-xs text-slate-400 mb-4">Use as <code className="font-mono">X-API-Key</code> header or <code className="font-mono">Authorization: Bearer</code> token.</p>
          <button onClick={() => setNewKey(null)} className="btn-primary w-full">Done</button>
        </Modal>
      )}
    </div>
  );
}
