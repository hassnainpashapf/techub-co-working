'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader, Badge, Modal, Field, Spinner, ErrorBanner, EmptyState, StatCard } from '../../../components/ui';
import { useRequireRoles, AccessDenied } from '../../../components/Protected';

const STATUS_TONE = { received: 'amber', notified: 'blue', collected: 'emerald' };

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ReceiveForm({ members, onSave, saving }) {
  const [f, setF] = useState({ memberId: '', type: 'package', sender: '', trackingNumber: '', notes: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <Field label="Member *">
        <select className="input" value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })} required>
          <option value="">Select member…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.companyName ? ` — ${m.companyName}` : ''}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type *">
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="package">📦 Package</option>
            <option value="letter">✉️ Letter</option>
          </select>
        </Field>
        <Field label="Sender"><input className="input" value={f.sender} onChange={(e) => setF({ ...f, sender: e.target.value })} placeholder="e.g. TCS, Amazon" maxLength={200} /></Field>
      </div>
      <Field label="Tracking number"><input className="input" value={f.trackingNumber} onChange={(e) => setF({ ...f, trackingNumber: e.target.value })} maxLength={100} /></Field>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <button type="submit" className="btn-primary w-full" disabled={saving}>{saving ? 'Logging…' : 'Log received item'}</button>
    </form>
  );
}

export default function MailPage() {
  const { allowed, loading: roleLoading } = useRequireRoles('ceo', 'admin', 'super_admin', 'manager', 'receptionist', 'operations_manager');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collecting, setCollecting] = useState(null);
  const [collectedBy, setCollectedBy] = useState('');

  const load = (f, query) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (f) params.set('status', f);
    if (query) params.set('q', query);
    api.get(`/mail?${params.toString()}`)
      .then((d) => { setItems(d.items || []); setCounts(Object.fromEntries((d.counts || []).map((c) => [c.status, c._count._all]))); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (allowed) load(filter, q); }, [allowed, filter]);

  const openReceive = async () => {
    setShowForm(true); setError('');
    try {
      const d = await api.get('/members');
      setMembers(d.members || d || []);
    } catch (e) { /* members optional */ }
  };

  const receive = async (data) => {
    setSaving(true);
    try {
      await api.post('/mail/receive', data);
      setShowForm(false); load(filter, q);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const collect = async (id) => {
    try {
      await api.post(`/mail/${id}/collect`, { collectedBy: collectedBy || null });
      setCollecting(null); setCollectedBy(''); load(filter, q);
    } catch (e) { setError(e.message); }
  };

  if (roleLoading) return <Spinner />;
  if (!allowed) return <AccessDenied />;

  const pending = (counts.received || 0) + (counts.notified || 0);

  return (
    <div>
      <PageHeader title="Mail & Packages" sub="Log incoming mail, notify members, track pickups" actions={
        <button className="btn-primary" onClick={openReceive}>📥 Log received item</button>
      } />
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Pending pickup" value={pending} accent={pending > 0 ? 'amber' : 'emerald'} />
        <StatCard label="Received" value={counts.received || 0} accent="amber" />
        <StatCard label="Notified" value={counts.notified || 0} accent="blue" />
        <StatCard label="Collected" value={counts.collected || 0} accent="emerald" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {['', 'received', 'notified', 'collected'].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${filter === s ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-100'}`}>
            {s === '' ? 'All' : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        <input className="input ml-auto w-56" placeholder="Search sender, tracking, member…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(filter, q)} />
      </div>

      {loading ? <Spinner /> : items.length === 0 ? <EmptyState title="No mail items" sub="Log an incoming letter or package to get started." /> : (
        <div className="card-premium overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 text-xs uppercase tracking-wide">
              <th className="p-3">Type</th><th className="p-3">Member</th><th className="p-3">Sender</th><th className="p-3">Tracking</th><th className="p-3">Received</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th>
            </tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className={`border-t border-gray-200 hover:bg-gray-100 ${it.status !== 'collected' ? 'font-semibold' : ''}`}>
                  <td className="p-3">{it.type === 'letter' ? '✉️ Letter' : '📦 Package'}</td>
                  <td className="p-3">{it.member?.name || '—'}{it.member?.companyName ? <span className="block text-xs text-gray-500">{it.member.companyName}</span> : null}</td>
                  <td className="p-3">{it.sender || '—'}</td>
                  <td className="p-3 font-mono text-xs">{it.trackingNumber || '—'}</td>
                  <td className="p-3 text-gray-500">{fmtDate(it.receivedAt)}</td>
                  <td className="p-3"><Badge tone={STATUS_TONE[it.status]}>{it.status}</Badge></td>
                  <td className="p-3 text-right">
                    {it.status !== 'collected' ? (
                      <button className="btn-secondary text-xs" onClick={() => setCollecting(it)}>✅ Mark collected</button>
                    ) : <span className="text-xs text-slate-500">{it.collectedBy ? `by ${it.collectedBy}` : ''} {fmtDate(it.collectedAt)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal title="Log received item" onClose={() => setShowForm(false)}>
          <ReceiveForm members={members} onSave={receive} saving={saving} />
        </Modal>
      )}

      {collecting && (
        <Modal title={`Mark collected — ${collecting.member?.name}`} onClose={() => { setCollecting(null); setCollectedBy(''); }}>
          <Field label="Collected by (name/signature note)">
            <input className="input" value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="e.g. Ahmed (signed)" maxLength={200} />
          </Field>
          <button className="btn-primary w-full" onClick={() => collect(collecting.id)}>Confirm collected</button>
        </Modal>
      )}
    </div>
  );
}
