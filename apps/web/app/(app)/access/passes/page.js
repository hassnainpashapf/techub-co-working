'use client';

// Phase 48 Track 5: Visitor day passes.
// Reception visitor ko time-bound day pass issue karti hai (QR token + WhatsApp share),
// active passes ki list, validate (scan flow) aur revoke.
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PageHeader, StatCard, Spinner, ErrorBanner, Field, Badge, DataTable, Modal, EmptyState } from '../../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../../components/Protected';

const PASS_ROLES = ['ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'ops', 'operations_manager'];

const STATUS_TONE = { active: 'green', used: 'slate', expired: 'amber', revoked: 'red' };

function qrImageUrl(token) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(token)}`;
}

export default function DayPassesPage() {
  const { allowed, checking } = useRequireRoles(PASS_ROLES);
  const [passes, setPasses] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState(null); // last created pass (QR + share)
  const [validating, setValidating] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState(null);

  const [form, setForm] = useState({ visitorName: '', visitorPhone: '', hostMemberId: '', validFrom: '', validUntil: '' });
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (allowed) { load(); loadMembers(); } }, [allowed, statusFilter]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/api/day-passes', { params: { status: statusFilter || undefined, limit: 50 } });
      setPasses(r.data?.passes || []);
      setTotal(r.data?.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || 'Passes load nahi ho sake');
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers() {
    try {
      const r = await api.get('/api/members', { params: { limit: 100 } });
      setMembers(r.data?.members || r.data || []);
    } catch { /* optional */ }
  }

  async function createPass(e) {
    e.preventDefault();
    if (!form.visitorName.trim() || saving) return;
    setSaving(true);
    try {
      const payload = {
        visitorName: form.visitorName.trim(),
        visitorPhone: form.visitorPhone.trim() || undefined,
        hostMemberId: form.hostMemberId || undefined,
        validFrom: form.validFrom || undefined,
        validUntil: form.validUntil || undefined,
      };
      const r = await api.post('/api/day-passes', payload);
      setCreated(r.data);
      setShowCreate(false);
      setForm({ visitorName: '', visitorPhone: '', hostMemberId: '', validFrom: '', validUntil: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Pass create nahi ho saka');
    } finally {
      setSaving(false);
    }
  }

  async function revoke(id) {
    if (!confirm('Is day pass ko revoke karna hai?')) return;
    try {
      await api.post(`/api/day-passes/${id}/revoke`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Revoke nahi ho saka');
    }
  }

  async function validateScan(e) {
    e?.preventDefault();
    if (!scanCode.trim() || validating) return;
    setValidating(true);
    setScanResult(null);
    try {
      const r = await api.post('/api/day-passes/validate', { code: scanCode.trim() });
      setScanResult({ ...r.data, time: new Date() });
      if (r.data?.ok) setScanCode('');
    } catch (err) {
      const d = err.response?.data || {};
      setScanResult({ ok: false, message: d.message || d.error || 'Validate failed', reason: d.reason, pass: d.pass, time: new Date() });
    } finally {
      setValidating(false);
    }
  }

  if (checking) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const activeCount = passes.filter((p) => p.status === 'active').length;
  const tone = (s) => STATUS_TONE[s] || 'slate';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visitor Day Passes"
        sub="Reception se visitor ko time-bound entry pass — QR + WhatsApp share"
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Naya Day Pass
          </button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total passes" value={total} />
        <StatCard label="Active" value={activeCount} accent="green" />
        <StatCard label="Filter" value={statusFilter || 'Sab'} sub="status filter" />
      </div>

      {/* Validate / scan */}
      <div className="card p-5 max-w-xl space-y-3">
        <h3 className="font-semibold text-gray-900">🔍 Pass validate karo (scan flow)</h3>
        <form onSubmit={validateScan} className="flex gap-2">
          <input
            className="input flex-1 font-mono"
            placeholder="Pass code paste/scan karo…"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={validating || !scanCode.trim()}>
            {validating ? 'Checking…' : 'Validate'}
          </button>
        </form>
        {scanResult && (
          <div className={`rounded-xl border p-4 ${scanResult.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
            <div className={`text-lg font-bold ${scanResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {scanResult.ok ? '✅ Entry allowed' : `⛔ ${scanResult.message || 'Invalid'}`}
            </div>
            {scanResult.pass && (
              <div className="mt-2 text-sm text-gray-600 space-y-1">
                <div>Visitor: <b>{scanResult.pass.visitorName}</b></div>
                <div>Code: <span className="font-mono">{scanResult.pass.code}</span></div>
                <div>Status: {scanResult.pass.status}</div>
                <div>Valid: {new Date(scanResult.pass.validFrom).toLocaleString()} → {new Date(scanResult.pass.validUntil).toLocaleString()}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Passes list */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900">Passes</h3>
          <select className="input w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Sab statuses</option>
            <option value="active">Active</option>
            <option value="used">Used</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
        {loading ? <Spinner /> : passes.length === 0 ? (
          <EmptyState title="Koi day pass nahi" hint="Upar 'Naya Day Pass' se visitor ke liye pass issue karo." />
        ) : (
          <DataTable
            columns={[
              { key: 'visitorName', label: 'Visitor' },
              { key: 'code', label: 'Code' },
              { key: 'host', label: 'Host' },
              { key: 'validity', label: 'Valid' },
              { key: 'status', label: 'Status' },
              { key: 'actions', label: '' },
            ]}
            rows={passes.map((p) => ({
              visitorName: <div><b>{p.visitorName}</b>{p.visitorPhone && <div className="text-xs text-gray-500">{p.visitorPhone}</div>}</div>,
              code: <span className="font-mono text-sm">{p.code}</span>,
              host: p.hostMember?.name || '—',
              validity: <span className="text-xs text-gray-600">{new Date(p.validFrom).toLocaleString()} →<br />{new Date(p.validUntil).toLocaleString()}</span>,
              status: <Badge tone={tone(p.status)}>{p.status}</Badge>,
              actions: p.status === 'active' ? (
                <button className="btn btn-sm btn-danger" onClick={() => revoke(p.id)}>Revoke</button>
              ) : null,
            }))}
          />
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal title="Naya Day Pass" onClose={() => setShowCreate(false)}>
          <form onSubmit={createPass} className="space-y-4">
            <Field label="Visitor ka naam *">
              <input className="input" value={form.visitorName} onChange={(e) => setForm({ ...form, visitorName: e.target.value })} required maxLength={120} />
            </Field>
            <Field label="Visitor ka phone">
              <input className="input" value={form.visitorPhone} onChange={(e) => setForm({ ...form, visitorPhone: e.target.value })} maxLength={30} />
            </Field>
            <Field label="Host member (optional)">
              <select className="input" value={form.hostMemberId} onChange={(e) => setForm({ ...form, hostMemberId: e.target.value })}>
                <option value="">— Koi nahi —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valid from (khali = abhi)">
                <input type="datetime-local" className="input" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
              </Field>
              <Field label="Valid until (khali = aaj raat)">
                <input type="datetime-local" className="input" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !form.visitorName.trim()}>
                {saving ? 'Ban raha hai…' : 'Pass issue karo'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Created pass — QR + WhatsApp share */}
      {created && (
        <Modal title="Day Pass tayyar ✅" onClose={() => setCreated(null)}>
          <div className="space-y-4 text-center">
            <div className="text-lg font-bold text-gray-900">{created.visitorName}</div>
            <div className="font-mono text-2xl tracking-widest text-teal-700">{created.code}</div>
            {created.qrToken && (
              <img src={qrImageUrl(created.qrToken)} alt="Day pass QR" className="mx-auto rounded-lg border border-gray-200" width={180} height={180} />
            )}
            <div className="text-sm text-gray-500">
              {new Date(created.validFrom).toLocaleString()} → {new Date(created.validUntil).toLocaleString()}
            </div>
            <a href={created.whatsappShare} target="_blank" rel="noreferrer" className="btn btn-primary w-full">
              📲 WhatsApp par share karo
            </a>
            <button className="btn w-full" onClick={() => setCreated(null)}>Band karo</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
